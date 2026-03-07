const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function getDeploymentsPath() {
  const custom = process.env.DEPLOYMENTS_FILE;
  return custom && custom.length > 0
    ? path.resolve(process.cwd(), custom)
    : path.resolve(process.cwd(), "deployments.json");
}

function readDeployments(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `deployments file not found: ${filePath}. Run deploy_policy_governor.js first.`
    );
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function getPolicyGovernorAddress(deployments, networkName) {
  const { ethers } = hre;
  const addr = deployments?.networks?.[networkName]?.contracts?.policyGovernor?.address;
  if (!addr || !ethers.isAddress(addr)) {
    throw new Error(
      `policyGovernor address missing in deployments for network ${networkName}`
    );
  }
  return addr;
}

async function main() {
  const { ethers, network } = hre;

  if (network.name !== "cchain_testnet") {
    throw new Error(
      `This script is intended for cchain_testnet. Current network: ${network.name}`
    );
  }

  const [finalizer] = await ethers.getSigners();
  if (!finalizer) {
    throw new Error("No signer available. Check PRIVATE_KEY in .env");
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);
  const governorAddress = getPolicyGovernorAddress(deployments, network.name);

  const governor = await ethers.getContractAt(
    "PolicyGovernor",
    governorAddress,
    finalizer
  );

  // Get epoch to finalize (from env var or use current epoch)
  const epochInput = process.env.FINALIZE_EPOCH || process.argv[2];
  let epochToFinalize;

  if (epochInput) {
    epochToFinalize = BigInt(epochInput);
  } else {
    epochToFinalize = await governor.getCurrentEpoch();
  }

  console.log(`PolicyGovernor: ${governorAddress}`);
  console.log(`Finalizer: ${finalizer.address}`);
  console.log(`Epoch to finalize: ${epochToFinalize}`);
  console.log("═".repeat(70));

  // Check if already finalized
  const isFinalized = await governor.isEpochFinalized(epochToFinalize);
  if (isFinalized) {
    console.log(`❌ Epoch ${epochToFinalize} is already finalized.`);
    console.log("\n💡 View the finalized policy:");
    console.log("   npx hardhat run scripts/read_cchain_policy.js --network cchain_testnet");
    return;
  }

  // Get epoch statistics
  const [
    validatorIds,
    votersCount,
    totalVP,
    quorumMode,
    quorumValue,
    votingPowerAddr,
  ] = await Promise.all([
    governor.getValidatorIds(),
    governor.votersByEpoch(epochToFinalize),
    governor.totalVotingPowerByEpoch(epochToFinalize),
    governor.quorumMode(),
    governor.quorumValue(),
    governor.votingPower(),
  ]);

  const votingPower = await ethers.getContractAt("VotingPowerV1", votingPowerAddr);
  const totalSystemVp = await votingPower.totalVotingPower();

  console.log("\n📊 Epoch Statistics:");
  console.log(`  Validators: ${validatorIds.length} (${validatorIds.map(id => id.toString()).join(", ")})`);
  console.log(`  Voters: ${votersCount}`);
  console.log(`  Total VP participated: ${ethers.formatUnits(totalVP, 6)}`);
  console.log(`  Total system VP: ${ethers.formatUnits(totalSystemVp, 6)}`);

  // Calculate quorum requirement
  let requiredVp;
  if (Number(quorumMode) === 0) {
    // ABSOLUTE mode
    requiredVp = quorumValue;
    console.log(`  Quorum required: ${ethers.formatUnits(requiredVp, 6)} VP (ABSOLUTE)`);
  } else {
    // BPS mode
    if (totalSystemVp === 0n) {
      console.log("❌ Cannot finalize: Total system voting power is 0");
      return;
    }
    // Ceiling division: (totalSystemVp * quorumValue + 10000 - 1) / 10000
    requiredVp = (totalSystemVp * quorumValue + 10000n - 1n) / 10000n;
    const quorumPct = (Number(quorumValue) / 100).toFixed(2);
    console.log(`  Quorum required: ${ethers.formatUnits(requiredVp, 6)} VP (${quorumPct}%)`);
  }

  const quorumReached = totalVP >= requiredVp;
  console.log(`  Quorum reached: ${quorumReached ? "✅ YES" : "❌ NO"}`);

  if (!quorumReached) {
    const remaining = requiredVp - totalVP;
    console.log(`\n❌ Cannot finalize epoch ${epochToFinalize}`);
    console.log(`   Need ${ethers.formatUnits(remaining, 6)} more VP to reach quorum`);
    console.log("\n💡 More voters need to participate:");
    console.log("   npx hardhat run scripts/vote_policy.js --network cchain_testnet");
    return;
  }

  // Additional validation before finalizing
  if (votersCount === 0n) {
    console.log("\n❌ Cannot finalize: No votes have been cast in this epoch");
    console.log("💡 Cast votes first:");
    console.log("   npx hardhat run scripts/vote_policy.js --network cchain_testnet");
    return;
  }

  console.log("\n⏳ Finalizing epoch...");
  console.log(`   (This will call governor.finalizeEpoch(${epochToFinalize}))`);

  try {
    // Estimate gas first to catch errors early
    const gasEstimate = await governor.finalizeEpoch.estimateGas(epochToFinalize);
    console.log(`   Estimated gas: ${gasEstimate.toString()}`);

    const finalizeTx = await governor.finalizeEpoch(epochToFinalize);
    const receipt = await finalizeTx.wait();

    console.log("✅ Epoch finalized successfully!");
    console.log(`Transaction hash: ${receipt.hash}`);

    // Get the finalized policy
    const policy = await governor.getPolicy(epochToFinalize);
    const latestFinalizedEpoch = await governor.getLatestFinalizedEpoch();

    console.log("\n📋 Finalized Policy:");
    let sumBps = 0;
    for (const p of policy) {
      const weightBps = Number(p.weightBps);
      sumBps += weightBps;
      const percentage = (weightBps / 100).toFixed(2);
      console.log(`  Validator ${p.validatorId}: ${weightBps} BPS (${percentage}%)`);
    }
    console.log(`  ─────────────────────────────`);
    console.log(`  Total: ${sumBps} BPS (${(sumBps / 100).toFixed(2)}%)`);

    console.log(`\n🎯 Latest Finalized Epoch: ${latestFinalizedEpoch}`);

    console.log("\n💡 View full policy details:");
    console.log("   npx hardhat run scripts/read_cchain_policy.js --network cchain_testnet");

  } catch (error) {
    console.error("\n❌ Failed to finalize epoch:");
    console.error(error.message || error);
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
