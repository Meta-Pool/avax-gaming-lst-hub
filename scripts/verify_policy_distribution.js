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

async function main() {
  const { ethers, network } = hre;

  if (network.name !== "beam_testnet") {
    throw new Error(
      `This script should run on beam_testnet. Current: ${network.name}`
    );
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);

  const vaultAddress =
    deployments?.networks?.beam_testnet?.contracts?.stBeamVault?.address;
  const policyClientAddress =
    deployments?.networks?.beam_testnet?.contracts?.policyClient?.address;

  if (!vaultAddress || !ethers.isAddress(vaultAddress)) {
    throw new Error("stBeamVault address not found in deployments.json");
  }

  if (!policyClientAddress || !ethers.isAddress(policyClientAddress)) {
    throw new Error("policyClient address not found in deployments.json");
  }

  console.log("=".repeat(70));
  console.log("🔍 VERIFY POLICY DISTRIBUTION");
  console.log("=".repeat(70));
  console.log(`Network: ${network.name}`);
  console.log(`Vault: ${vaultAddress}`);
  console.log(`PolicyClient: ${policyClientAddress}`);
  console.log("=".repeat(70));

  const vault = await ethers.getContractAt("StBEAMVault", vaultAddress);
  
  // Try MockPolicyClient first, then regular PolicyClient
  let policyClient;
  try {
    policyClient = await ethers.getContractAt("MockPolicyClient", policyClientAddress);
  } catch {
    policyClient = await ethers.getContractAt("PolicyClient", policyClientAddress);
  }

  // Get vault's applicable epoch
  const applicableEpoch = await vault.getApplicablePolicyEpoch();
  console.log(`\n📅 Applicable Policy Epoch: ${applicableEpoch}`);

  // Get active policy from vault
  const activePolicyRaw = await vault.getActivePolicy();
  const activePolicyEpoch = activePolicyRaw[0] || activePolicyRaw.epoch;
  const activeValidatorIds = activePolicyRaw[1] || activePolicyRaw.validatorIds;
  const activeWeights = activePolicyRaw[2] || activePolicyRaw.weightsBps;

  console.log(`\n📜 Active Policy in Vault (Epoch ${activePolicyEpoch}):`);
  
  const policyMap = new Map();
  let totalWeightBps = 0;

  activeValidatorIds.forEach((id, i) => {
    const weightBps = Number(activeWeights[i]);
    const percent = (weightBps / 100).toFixed(2);
    policyMap.set(id.toString(), weightBps);
    totalWeightBps += weightBps;
    console.log(`  Validator ${id}: ${weightBps} BPS (${percent}%)`);
  });

  console.log(`  Total: ${totalWeightBps} BPS (${(totalWeightBps / 100).toFixed(2)}%)`);

  if (totalWeightBps !== 10000) {
    console.log(`  ⚠️  Warning: Total weights don't sum to 10000 BPS!`);
  }

  // Get buckets from vault
  const [bucketIds, bucketAmounts] = await vault.getBuckets();
  console.log(`\n📦 Validator Buckets (${bucketIds.length} buckets):`);

  const bucketMap = new Map();
  let totalInBuckets = 0n;

  bucketIds.forEach((id, i) => {
    const amount = bucketAmounts[i];
    bucketMap.set(id.toString(), amount);
    totalInBuckets += amount;
    console.log(`  Validator ${id}: ${ethers.formatUnits(amount, 18)} WBEAM`);
  });

  console.log(`  Total in buckets: ${ethers.formatUnits(totalInBuckets, 18)} WBEAM`);

  // Get total assets for calculating expected distribution
  const totalAssets = await vault.totalAssets();
  console.log(`\n💰 Vault Total Assets: ${ethers.formatUnits(totalAssets, 18)} WBEAM`);

  // Verify distribution matches policy
  console.log(`\n🔍 Verifying Distribution Accuracy:`);
  
  let allMatch = true;
  const tolerance = 2n; // Allow 2 wei tolerance for rounding

  for (const [validatorId, weightBps] of policyMap.entries()) {
    const actualAmount = bucketMap.get(validatorId) || 0n;
    const expectedAmount = (totalInBuckets * BigInt(weightBps)) / 10000n;
    const diff = actualAmount > expectedAmount 
      ? actualAmount - expectedAmount 
      : expectedAmount - actualAmount;

    const percentOfTotal = totalInBuckets > 0n 
      ? Number((actualAmount * 10000n) / totalInBuckets) / 100
      : 0;

    console.log(`\n  Validator ${validatorId}:`);
    console.log(`    Policy weight: ${weightBps} BPS (${(weightBps / 100).toFixed(2)}%)`);
    console.log(`    Expected amount: ${ethers.formatUnits(expectedAmount, 18)} WBEAM`);
    console.log(`    Actual amount:   ${ethers.formatUnits(actualAmount, 18)} WBEAM`);
    console.log(`    Actual %:        ${percentOfTotal.toFixed(2)}%`);
    console.log(`    Difference:      ${ethers.formatUnits(diff, 18)} WBEAM`);

    if (diff <= tolerance) {
      console.log(`    ✅ Match (within tolerance)`);
    } else {
      console.log(`    ❌ Mismatch! (diff: ${diff} wei)`);
      allMatch = false;
    }
  }

  // Check for buckets not in policy
  for (const [validatorId, amount] of bucketMap.entries()) {
    if (!policyMap.has(validatorId) && amount > 0n) {
      console.log(`\n  ⚠️  Validator ${validatorId}:`);
      console.log(`    Not in policy but has ${ethers.formatUnits(amount, 18)} WBEAM`);
      allMatch = false;
    }
  }

  // Get policy from PolicyClient for comparison
  console.log(`\n📋 Policy in PolicyClient:`);
  const lastKnownEpoch = await policyClient.lastKnownEpoch();
  console.log(`  Last known epoch: ${lastKnownEpoch}`);

  if (lastKnownEpoch > 0n) {
    const [epoch, ids, weights] = await policyClient.getLastKnownPolicy();
    console.log(`  Policy for epoch ${epoch}:`);
    ids.forEach((id, i) => {
      const bps = Number(weights[i]);
      console.log(`    Validator ${id}: ${bps} BPS (${(bps / 100).toFixed(2)}%)`);
    });

    // Check if policy client matches vault policy
    if (epoch === activePolicyEpoch) {
      console.log(`  ✅ PolicyClient epoch matches Vault active policy`);
    } else {
      console.log(`  ⚠️  PolicyClient epoch ${epoch} != Vault active epoch ${activePolicyEpoch}`);
    }
  } else {
    console.log(`  ⚠️  No policy set in PolicyClient yet`);
  }

  // Final summary
  console.log("\n" + "=".repeat(70));
  console.log("📊 SUMMARY:");
  console.log("=".repeat(70));
  
  if (allMatch) {
    console.log("✅ All buckets match policy weights correctly!");
    console.log("✅ The vault is distributing assets according to governance policy");
  } else {
    console.log("❌ Distribution does not match policy!");
    console.log("⚠️  Check the policy application logic");
  }

  if (totalWeightBps === 10000) {
    console.log("✅ Policy weights sum to 100%");
  } else {
    console.log(`⚠️  Policy weights sum to ${(totalWeightBps / 100).toFixed(2)}% (expected 100%)`);
  }

  console.log("=".repeat(70));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
