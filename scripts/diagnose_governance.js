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
    throw new Error(`deployments file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const { ethers, network } = hre;

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);
  
  const [signer] = await ethers.getSigners();
  
  console.log("🔍 GOVERNANCE STATE DIAGNOSTIC");
  console.log("═".repeat(70));
  console.log(`Network: ${network.name}`);
  console.log(`Signer: ${signer.address}`);
  console.log("═".repeat(70));

  // Check VotingPower
  const vpAddr = deployments?.networks?.[network.name]?.contracts?.votingPower?.proxy;
  if (vpAddr) {
    console.log("\n📊 VOTING POWER CONTRACT");
    console.log(`Address: ${vpAddr}`);
    const vp = await ethers.getContractAt("VotingPowerV1", vpAddr);
    
    const [totalVP, totalMpDAO, signerVP, signerMpDAO] = await Promise.all([
      vp.totalVotingPower(),
      vp.totalMpDAO(),
      vp.getVotingPower(signer.address),
      vp.getLockedAmount(signer.address),
    ]);
    
    console.log(`Total System VP: ${ethers.formatUnits(totalVP, 6)}`);
    console.log(`Total Locked mpDAO: ${ethers.formatUnits(totalMpDAO, 6)}`);
    console.log(`Signer's VP: ${ethers.formatUnits(signerVP, 6)}`);
    console.log(`Signer's Locked mpDAO: ${ethers.formatUnits(signerMpDAO, 6)}`);
    
    if (signerVP === 0n) {
      console.log("⚠️  WARNING: Signer has no voting power! Run stake_for_vp.js first.");
    }
    if (totalVP === 0n) {
      console.log("⚠️  WARNING: No voting power in system! Cannot finalize epochs.");
    }
  } else {
    console.log("\n❌ VotingPower contract not found in deployments");
  }

  // Check PolicyGovernor
  const govAddr = deployments?.networks?.[network.name]?.contracts?.policyGovernor?.address;
  if (govAddr) {
    console.log("\n🏛️  POLICY GOVERNOR CONTRACT");
    console.log(`Address: ${govAddr}`);
    const gov = await ethers.getContractAt("PolicyGovernor", govAddr);
    
    const [
      currentEpoch,
      latestFinalized,
      epochSeconds,
      startTimestamp,
      quorumMode,
      quorumValue,
      validatorIds,
      votingPowerAddr,
    ] = await Promise.all([
      gov.getCurrentEpoch(),
      gov.getLatestFinalizedEpoch(),
      gov.EPOCH_SECONDS(),
      gov.START_TIMESTAMP(),
      gov.quorumMode(),
      gov.quorumValue(),
      gov.getValidatorIds(),
      gov.votingPower(),
    ]);
    
    console.log(`Current Epoch: ${currentEpoch}`);
    console.log(`Latest Finalized Epoch: ${latestFinalized}`);
    console.log(`Epoch Duration: ${epochSeconds} seconds (${Number(epochSeconds) / 86400} days)`);
    console.log(`Start Timestamp: ${startTimestamp} (${new Date(Number(startTimestamp) * 1000).toISOString()})`);
    console.log(`Quorum Mode: ${Number(quorumMode) === 0 ? "ABSOLUTE" : "BPS"}`);
    console.log(`Quorum Value: ${quorumValue}`);
    console.log(`Validators: [${validatorIds.map(id => id.toString()).join(", ")}]`);
    console.log(`Linked VotingPower: ${votingPowerAddr}`);
    
    // Check current epoch status
    console.log(`\n📋 CURRENT EPOCH (${currentEpoch}) STATUS:`);
    const [isFinalized, voters, totalVP, hasVoted] = await Promise.all([
      gov.isEpochFinalized(currentEpoch),
      gov.votersByEpoch(currentEpoch),
      gov.totalVotingPowerByEpoch(currentEpoch),
      gov.hasVoted(currentEpoch, signer.address),
    ]);
    
    console.log(`Finalized: ${isFinalized ? "✅ YES" : "❌ NO"}`);
    console.log(`Voters: ${voters}`);
    console.log(`Total VP Participated: ${ethers.formatUnits(totalVP, 6)}`);
    console.log(`Signer has voted: ${hasVoted ? "✅ YES" : "❌ NO"}`);
    
    if (voters === 0n) {
      console.log("⚠️  WARNING: No votes cast in current epoch! Run vote_policy.js first.");
    }
    if (totalVP === 0n) {
      console.log("⚠️  WARNING: Zero voting power participated! Cannot finalize.");
    }
    
    // Calculate quorum requirement
    if (vpAddr) {
      const vp = await ethers.getContractAt("VotingPowerV1", vpAddr);
      const totalSystemVP = await vp.totalVotingPower();
      
      let requiredVp;
      if (Number(quorumMode) === 0) {
        requiredVp = quorumValue;
      } else {
        if (totalSystemVP === 0n) {
          requiredVp = 0n;
          console.log("⚠️  WARNING: Total system VP is 0 - quorum calculation impossible!");
        } else {
          requiredVp = (totalSystemVP * quorumValue + 10000n - 1n) / 10000n;
        }
      }
      
      console.log(`\n🎯 QUORUM ANALYSIS:`);
      console.log(`Required VP: ${ethers.formatUnits(requiredVp, 6)}`);
      console.log(`Current VP: ${ethers.formatUnits(totalVP, 6)}`);
      console.log(`Quorum Reached: ${totalVP >= requiredVp ? "✅ YES" : "❌ NO"}`);
      
      if (totalVP < requiredVp) {
        const needed = requiredVp - totalVP;
        console.log(`Need ${ethers.formatUnits(needed, 6)} more VP`);
      }
    }
    
  } else {
    console.log("\n❌ PolicyGovernor contract not found in deployments");
  }
  
  console.log("\n" + "═".repeat(70));
  console.log("✅ Diagnostic complete");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
