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
    throw new Error(`Deployments file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseWeights(value, fallbackCsv) {
  const raw = (value && value.length > 0 ? value : fallbackCsv).split(",");
  const weights = raw.map((v) => Number(v.trim()));
  
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum !== 10000) {
    throw new Error(`Weights must sum to 10000 BPS (100%), got ${sum}`);
  }
  
  return weights;
}

function parseValidatorIds(value, fallbackCsv) {
  const raw = (value && value.length > 0 ? value : fallbackCsv).split(",");
  return raw.map((v) => BigInt(v.trim()));
}

async function main() {
  const { ethers, network } = hre;
  
  if (network.name !== "beam_testnet") {
    throw new Error(`This script should run on beam_testnet. Current: ${network.name}`);
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);

  const policyClientAddress = 
    deployments?.networks?.beam_testnet?.contracts?.policyClient?.address;

  if (!policyClientAddress || !ethers.isAddress(policyClientAddress)) {
    throw new Error("PolicyClient address not found in deployments.json for beam_testnet");
  }

  const [signer] = await ethers.getSigners();
  
  console.log("=".repeat(70));
  console.log("🔄 UPDATE MOCK POLICY CLIENT");
  console.log("=".repeat(70));
  console.log(`Network: ${network.name}`);
  console.log(`Signer: ${signer.address}`);
  console.log(`PolicyClient: ${policyClientAddress}`);
  
  const balance = await ethers.provider.getBalance(signer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} BEAM`);
  console.log("=".repeat(70));

  const policyClient = await ethers.getContractAt(
    "MockPolicyClient",
    policyClientAddress
  );

  // Get current policy
  const currentLastKnownEpoch = await policyClient.lastKnownEpoch();
  console.log(`\n📊 Current lastKnownEpoch: ${currentLastKnownEpoch}`);
  
  if (currentLastKnownEpoch > 0n) {
    const [epoch, ids, weights] = await policyClient.getLastKnownPolicy();
    console.log("Current policy:");
    ids.forEach((id, i) => {
      const bps = Number(weights[i]);
      const pct = (bps / 100).toFixed(2);
      console.log(`  Validator ${id}: ${bps} BPS (${pct}%)`);
    });
  }

  // Parse new policy from env or use defaults matching the governance expectations
  const targetEpoch = BigInt(process.env.UPDATE_POLICY_EPOCH || "1");
  const validatorIds = parseValidatorIds(
    process.env.UPDATE_POLICY_VALIDATOR_IDS,
    "1,2,3,4"
  );
  const weights = parseWeights(
    process.env.UPDATE_POLICY_WEIGHTS_BPS,
    "6000,3000,900,100" // 60%, 30%, 9%, 1%
  );

  console.log(`\n🎯 New policy for epoch ${targetEpoch}:`);
  validatorIds.forEach((id, i) => {
    const bps = weights[i];
    const pct = (bps / 100).toFixed(2);
    console.log(`  Validator ${id}: ${bps} BPS (${pct}%)`);
  });

  console.log("\n📝 Updating policy...");
  const tx = await policyClient.setPolicy(targetEpoch, validatorIds, weights);
  console.log(`Transaction hash: ${tx.hash}`);
  
  console.log("⏳ Waiting for confirmation...");
  const receipt = await tx.wait();
  
  console.log(`✅ Policy updated! (Block: ${receipt.blockNumber})`);
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);

  // Verify the update
  console.log("\n🔍 Verifying update...");
  const newLastKnownEpoch = await policyClient.lastKnownEpoch();
  const [epoch, ids, newWeights] = await policyClient.getLastKnownPolicy();
  
  console.log(`\nUpdated lastKnownEpoch: ${newLastKnownEpoch}`);
  console.log("Updated policy:");
  ids.forEach((id, i) => {
    const bps = Number(newWeights[i]);
    const pct = (bps / 100).toFixed(2);
    console.log(`  Validator ${id}: ${bps} BPS (${pct}%)`);
  });

  const finalBalance = await ethers.provider.getBalance(signer.address);
  const gasSpent = balance - finalBalance;
  console.log(`\n💸 Gas spent: ${ethers.formatEther(gasSpent)} BEAM`);
  console.log(`💰 Remaining balance: ${ethers.formatEther(finalBalance)} BEAM`);
  console.log("=".repeat(70));
}

main().catch((error) => {
  console.error("\n❌ UPDATE FAILED");
  console.error("=".repeat(70));
  console.error(error.message || error);
  process.exitCode = 1;
});
