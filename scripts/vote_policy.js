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

function parseWeights(weightsStr) {
  if (!weightsStr) return null;
  
  return weightsStr.split(",").map((w) => {
    const weight = Number(w.trim());
    if (Number.isNaN(weight) || weight < 0 || weight > 10000) {
      throw new Error(`Invalid weight value: ${w}`);
    }
    return weight;
  });
}

async function main() {
  const { ethers, network } = hre;

  if (network.name !== "cchain_testnet") {
    throw new Error(
      `This script is intended for cchain_testnet. Current network: ${network.name}`
    );
  }

  const [voter] = await ethers.getSigners();
  if (!voter) {
    throw new Error("No signer available. Check PRIVATE_KEY in .env");
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);
  const governorAddress = getPolicyGovernorAddress(deployments, network.name);

  const governor = await ethers.getContractAt(
    "PolicyGovernor",
    governorAddress,
    voter
  );

  // Get current epoch and validator info
  const [currentEpoch, validatorIds, isFinalized, votingPowerAddr] = await Promise.all([
    governor.getCurrentEpoch(),
    governor.getValidatorIds(),
    governor.isEpochFinalized(await governor.getCurrentEpoch()),
    governor.votingPower(),
  ]);

  console.log(`PolicyGovernor: ${governorAddress}`);
  console.log(`Voter: ${voter.address}`);
  console.log(`Current Epoch: ${currentEpoch}`);
  console.log(`Validators: ${validatorIds.map(id => id.toString()).join(", ")}`);
  console.log("─".repeat(70));

  if (isFinalized) {
    throw new Error(
      `Epoch ${currentEpoch} is already finalized. Cannot vote on finalized epoch.`
    );
  }

  // Check if voter already voted
  const hasVoted = await governor.hasVoted(currentEpoch, voter.address);
  if (hasVoted) {
    throw new Error(
      `${voter.address} has already voted in epoch ${currentEpoch}`
    );
  }

  // Check voter's voting power
  const votingPower = await ethers.getContractAt("VotingPowerV1", votingPowerAddr);
  const voterVp = await votingPower.getVotingPower(voter.address);
  
  if (voterVp === 0n) {
    throw new Error(
      `${voter.address} has no voting power. Stake mpDAO first (run stake_for_vp.js).`
    );
  }

  console.log(`Voter's Voting Power: ${ethers.formatUnits(voterVp, 6)}`);

  // Parse weights from environment variable or use default
  const weightsStr = process.env.VOTE_WEIGHTS || "6000,3000,900,100";
  const weights = parseWeights(weightsStr);

  if (weights.length !== validatorIds.length) {
    throw new Error(
      `Weights count (${weights.length}) must match validator count (${validatorIds.length})`
    );
  }

  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum !== 10000) {
    throw new Error(
      `Weights must sum to 10000 BPS (100%). Current sum: ${sum}`
    );
  }

  console.log("\n📊 Vote Distribution:");
  for (let i = 0; i < validatorIds.length; i++) {
    const percentage = (weights[i] / 100).toFixed(2);
    console.log(`  Validator ${validatorIds[i]}: ${weights[i]} BPS (${percentage}%)`);
  }

  console.log("\n🗳️  Casting vote...");
  const voteTx = await governor.vote(weights);
  const receipt = await voteTx.wait();

  console.log("✅ Vote successfully cast!");
  console.log(`Transaction hash: ${receipt.hash}`);

  // Get updated epoch stats
  const [votersCount, totalVP, quorumMode, quorumValue] = await Promise.all([
    governor.votersByEpoch(currentEpoch),
    governor.totalVotingPowerByEpoch(currentEpoch),
    governor.quorumMode(),
    governor.quorumValue(),
  ]);

  console.log("\n📈 Epoch Statistics:");
  console.log(`  Voters in epoch ${currentEpoch}: ${votersCount}`);
  console.log(`  Total VP participated: ${ethers.formatUnits(totalVP, 6)}`);
  
  // Calculate quorum requirement
  let requiredVp;
  if (Number(quorumMode) === 0) {
    // ABSOLUTE mode
    requiredVp = quorumValue;
    console.log(`  Quorum required: ${ethers.formatUnits(requiredVp, 6)} VP (ABSOLUTE)`);
  } else {
    // BPS mode
    const totalSystemVp = await votingPower.totalVotingPower();
    requiredVp = (totalSystemVp * quorumValue) / 10000n;
    const quorumPct = (Number(quorumValue) / 100).toFixed(2);
    console.log(`  Quorum required: ${ethers.formatUnits(requiredVp, 6)} VP (${quorumPct}% of ${ethers.formatUnits(totalSystemVp, 6)})`);
  }

  const quorumReached = totalVP >= requiredVp;
  console.log(`  Quorum reached: ${quorumReached ? "✅ YES" : "❌ NO"}`);

  if (quorumReached) {
    console.log("\n💡 Quorum reached! You can now finalize the epoch:");
    console.log("   npx hardhat run scripts/finalize_epoch.js --network cchain_testnet");
  } else {
    const remaining = requiredVp - totalVP;
    console.log(`\n⏳ Need ${ethers.formatUnits(remaining, 6)} more VP to reach quorum`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
