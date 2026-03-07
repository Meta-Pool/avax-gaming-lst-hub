const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function getDeploymentsPath(customPath) {
  if (customPath) return path.resolve(process.cwd(), customPath);
  if (process.env.DEPLOYMENTS_FILE) {
    return path.resolve(process.cwd(), process.env.DEPLOYMENTS_FILE);
  }
  return path.resolve(process.cwd(), "deployments.json");
}

function readDeploymentsSafe(customPath) {
  const filePath = getDeploymentsPath(customPath);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function getVaultFromDeployments(deployments, networkName) {
  const contracts = deployments?.networks?.[networkName]?.contracts || {};
  return (
    contracts.stBeamVault?.address ||
    contracts.stBEAMVault?.address ||
    contracts.stBeamVault ||
    contracts.stBEAMVault ||
    ""
  );
}

function getPolicyClientFromDeployments(deployments, networkName) {
  const contracts = deployments?.networks?.[networkName]?.contracts || {};
  return contracts.policyClient?.address || contracts.policyClient || "";
}

function pickTupleValue(result, index, key) {
  if (result == null) return undefined;
  if (result[index] !== undefined) return result[index];
  return result[key];
}

async function safeCall(name, fn) {
  try {
    console.log(`🔍 Calling: ${name}...`);
    const result = await fn();
    console.log(`✅ ${name} succeeded`);
    return { success: true, result };
  } catch (error) {
    console.log(`❌ ${name} FAILED: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  const { ethers, network } = hre;
  const args = parseArgs();
  const deployments = readDeploymentsSafe(args.deployments);

  const vaultCandidate =
    args.vault ||
    process.env.STBEAM_VAULT_ADDRESS ||
    getVaultFromDeployments(deployments, network.name);

  if (!vaultCandidate || !ethers.isAddress(vaultCandidate)) {
    throw new Error(
      `stBEAM vault address not found. Use --vault, STBEAM_VAULT_ADDRESS, or deployments.json under networks.${network.name}.contracts.stBeamVault`
    );
  }

  const vaultAddress = ethers.getAddress(vaultCandidate);
  console.log("=== DEBUG: BEAM VAULT READ ===");
  console.log(`network: ${network.name}`);
  console.log(`vault: ${vaultAddress}`);
  console.log("\n--- Testing individual contract calls ---\n");

  const vault = await ethers.getContractAt("StBEAMVault", vaultAddress);

  // Test each call individually
  const chain = await safeCall("getNetwork", () => ethers.provider.getNetwork());
  const asset = await safeCall("vault.asset()", () => vault.asset());
  const totalAssets = await safeCall("vault.totalAssets()", () => vault.totalAssets());
  const totalSupply = await safeCall("vault.totalSupply()", () => vault.totalSupply());
  const feeAccumulator = await safeCall("vault.feeAccumulator()", () => vault.feeAccumulator());
  const feeBps = await safeCall("vault.DEPOSIT_FEE_BPS()", () => vault.DEPOSIT_FEE_BPS());
  const policyEpochSeconds = await safeCall("vault.POLICY_EPOCH_SECONDS()", () => vault.POLICY_EPOCH_SECONDS());
  const policyStartTimestamp = await safeCall("vault.POLICY_START_TIMESTAMP()", () => vault.POLICY_START_TIMESTAMP());
  const vaultPolicyClientAddress = await safeCall("vault.policyClient()", () => vault.policyClient());
  const applicableEpoch = await safeCall("vault.getApplicablePolicyEpoch()", () => vault.getApplicablePolicyEpoch());
  const currentPolicyEpoch = await safeCall("vault.currentPolicyEpoch()", () => vault.currentPolicyEpoch());
  const lastPolicyRequestEpoch = await safeCall("vault.lastPolicyRequestEpoch()", () => vault.lastPolicyRequestEpoch());
  const activePolicyRaw = await safeCall("vault.getActivePolicy()", () => vault.getActivePolicy());
  const bucketsRaw = await safeCall("vault.getBuckets()", () => vault.getBuckets());

  console.log("\n--- Results Summary ---\n");

  if (chain.success) {
    console.log(`chainId: ${chain.result.chainId.toString()}`);
  }

  if (asset.success) {
    console.log(`asset: ${asset.result}`);
  }

  if (totalAssets.success) {
    console.log(`totalAssets: ${totalAssets.result.toString()}`);
  }

  if (totalSupply.success) {
    console.log(`totalSupply(stBEAM): ${totalSupply.result.toString()}`);
  }

  if (feeAccumulator.success) {
    console.log(`feeAccumulator: ${feeAccumulator.result.toString()}`);
  }

  if (feeBps.success) {
    console.log(`DEPOSIT_FEE_BPS: ${feeBps.result.toString()}`);
  }

  if (policyEpochSeconds.success) {
    console.log(`POLICY_EPOCH_SECONDS: ${policyEpochSeconds.result.toString()}`);
  }

  if (policyStartTimestamp.success) {
    console.log(`POLICY_START_TIMESTAMP: ${policyStartTimestamp.result.toString()}`);
    console.log(`  Note: 0 means not initialized properly - should be a valid timestamp!`);
  }

  if (applicableEpoch.success) {
    console.log(`applicableEpoch (epoch-1): ${applicableEpoch.result.toString()}`);
  }

  if (currentPolicyEpoch.success) {
    console.log(`currentPolicyEpoch: ${currentPolicyEpoch.result.toString()}`);
  }

  if (lastPolicyRequestEpoch.success) {
    console.log(`lastPolicyRequestEpoch: ${lastPolicyRequestEpoch.result.toString()}`);
  }

  if (activePolicyRaw.success) {
    const activePolicyEpoch = pickTupleValue(activePolicyRaw.result, 0, "epoch") || 0n;
    const activeValidatorIds = pickTupleValue(activePolicyRaw.result, 1, "validatorIds") || [];
    const activeWeights = pickTupleValue(activePolicyRaw.result, 2, "weightsBps") || [];
    console.log(`activePolicyEpoch: ${activePolicyEpoch.toString()}`);
    console.log(
      "activePolicy:",
      activeValidatorIds.map((id, i) => ({
        validatorId: id.toString(),
        weightBps: Number(activeWeights[i]),
      }))
    );
  }

  if (bucketsRaw.success) {
    const bucketIds = pickTupleValue(bucketsRaw.result, 0, "validatorIds") || [];
    const bucketAmounts = pickTupleValue(bucketsRaw.result, 1, "amounts") || [];
    const bucketSum = bucketAmounts.reduce((acc, x) => acc + x, 0n);
    console.log(
      "buckets:",
      bucketIds.map((id, i) => ({
        validatorId: id.toString(),
        amount: bucketAmounts[i].toString(),
      }))
    );
    console.log(`bucketsSum: ${bucketSum.toString()}`);
  }

  // Test policy client if available
  if (vaultPolicyClientAddress.success) {
    const policyClientCandidate =
      args.policyClient ||
      process.env.POLICY_CLIENT_ADDRESS ||
      getPolicyClientFromDeployments(deployments, network.name) ||
      vaultPolicyClientAddress.result;

    if (
      policyClientCandidate &&
      ethers.isAddress(policyClientCandidate) &&
      ethers.getAddress(policyClientCandidate) !== ethers.ZeroAddress
    ) {
      console.log("\n--- Testing PolicyClient calls ---\n");
      console.log(`policyClient: ${policyClientCandidate}`);

      const policyClient = await ethers.getContractAt(
        "PolicyClient",
        policyClientCandidate
      );

      const lastKnownRaw = await safeCall(
        "policyClient.getLastKnownPolicy()",
        () => policyClient.getLastKnownPolicy()
      );

      if (applicableEpoch.success) {
        const hasApplicable = await safeCall(
          `policyClient.hasPolicyForEpoch(${applicableEpoch.result})`,
          () => policyClient.hasPolicyForEpoch(applicableEpoch.result)
        );

        if (hasApplicable.success && hasApplicable.result) {
          await safeCall(
            `policyClient.getPolicy(${applicableEpoch.result})`,
            () => policyClient.getPolicy(applicableEpoch.result)
          );
        }
      }
    }
  }

  console.log("\n=== DEBUG COMPLETE ===");
}

main().catch((error) => {
  console.error("\n❌ CRITICAL ERROR:");
  console.error(error.message || error);
  console.error("\nStack trace:");
  console.error(error.stack);
  process.exitCode = 1;
});
