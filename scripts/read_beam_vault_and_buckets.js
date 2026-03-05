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
  const vault = await ethers.getContractAt("StBEAMVault", vaultAddress);

  const [
    chain,
    asset,
    totalAssets,
    totalSupply,
    feeAccumulator,
    feeBps,
    policyEpochSeconds,
    policyStartTimestamp,
    vaultPolicyClientAddress,
    applicableEpoch,
    currentPolicyEpoch,
    lastPolicyRequestEpoch,
    activePolicyRaw,
    bucketsRaw,
  ] = await Promise.all([
    ethers.provider.getNetwork(),
    vault.asset(),
    vault.totalAssets(),
    vault.totalSupply(),
    vault.feeAccumulator(),
    vault.DEPOSIT_FEE_BPS(),
    vault.POLICY_EPOCH_SECONDS(),
    vault.POLICY_START_TIMESTAMP(),
    vault.policyClient(),
    vault.getApplicablePolicyEpoch(),
    vault.currentPolicyEpoch(),
    vault.lastPolicyRequestEpoch(),
    vault.getActivePolicy(),
    vault.getBuckets(),
  ]);

  const activePolicyEpoch = pickTupleValue(activePolicyRaw, 0, "epoch") || 0n;
  const activeValidatorIds = pickTupleValue(activePolicyRaw, 1, "validatorIds") || [];
  const activeWeights = pickTupleValue(activePolicyRaw, 2, "weightsBps") || [];

  const bucketIds = pickTupleValue(bucketsRaw, 0, "validatorIds") || [];
  const bucketAmounts = pickTupleValue(bucketsRaw, 1, "amounts") || [];
  const bucketSum = bucketAmounts.reduce((acc, x) => acc + x, 0n);

  const policyClientCandidate =
    args.policyClient ||
    process.env.POLICY_CLIENT_ADDRESS ||
    getPolicyClientFromDeployments(deployments, network.name) ||
    vaultPolicyClientAddress;

  let clientSummary = null;
  if (
    policyClientCandidate &&
    ethers.isAddress(policyClientCandidate) &&
    ethers.getAddress(policyClientCandidate) !== ethers.ZeroAddress
  ) {
    const policyClient = await ethers.getContractAt(
      "PolicyClient",
      policyClientCandidate
    );

    const [lastKnownRaw, hasApplicable] = await Promise.all([
      policyClient.getLastKnownPolicy(),
      policyClient.hasPolicyForEpoch(applicableEpoch),
    ]);

    const lastKnownEpoch = pickTupleValue(lastKnownRaw, 0, "epoch") || 0n;
    const lastKnownIds = pickTupleValue(lastKnownRaw, 1, "validatorIds") || [];
    const lastKnownWeights = pickTupleValue(lastKnownRaw, 2, "weightBps") || [];

    let applicablePolicyIds = [];
    let applicablePolicyWeights = [];
    if (hasApplicable) {
      const applicablePolicyRaw = await policyClient.getPolicy(applicableEpoch);
      applicablePolicyIds =
        pickTupleValue(applicablePolicyRaw, 0, "validatorIds") || [];
      applicablePolicyWeights =
        pickTupleValue(applicablePolicyRaw, 1, "weightBps") || [];
    }

    clientSummary = {
      address: ethers.getAddress(policyClientCandidate),
      hasApplicable,
      lastKnownEpoch,
      lastKnownIds,
      lastKnownWeights,
      applicablePolicyIds,
      applicablePolicyWeights,
    };
  }

  console.log("=== BEAM VAULT + BUCKETS STATE ===");
  console.log(`network: ${network.name}`);
  console.log(`chainId: ${chain.chainId.toString()}`);
  console.log(`vault: ${vaultAddress}`);
  console.log(`asset: ${asset}`);
  console.log(`totalAssets: ${totalAssets.toString()}`);
  console.log(`totalSupply(stBEAM): ${totalSupply.toString()}`);
  console.log(`feeAccumulator: ${feeAccumulator.toString()}`);
  console.log(`DEPOSIT_FEE_BPS: ${feeBps.toString()}`);
  console.log(`POLICY_EPOCH_SECONDS: ${policyEpochSeconds.toString()}`);
  console.log(`POLICY_START_TIMESTAMP: ${policyStartTimestamp.toString()}`);
  console.log(`applicableEpoch (epoch-1): ${applicableEpoch.toString()}`);
  console.log(`lastPolicyRequestEpoch: ${lastPolicyRequestEpoch.toString()}`);
  console.log(`activePolicyEpoch: ${activePolicyEpoch.toString()}`);
  console.log(
    "activePolicy:",
    activeValidatorIds.map((id, i) => ({
      validatorId: id.toString(),
      weightBps: Number(activeWeights[i]),
    }))
  );
  console.log(
    "buckets:",
    bucketIds.map((id, i) => ({
      validatorId: id.toString(),
      amount: bucketAmounts[i].toString(),
    }))
  );
  console.log(`bucketsSum: ${bucketSum.toString()}`);

  if (!clientSummary) {
    console.log("policyClient: <not resolved>");
    return;
  }

  console.log(`policyClient: ${clientSummary.address}`);
  console.log(
    `hasPolicyForApplicableEpoch: ${clientSummary.hasApplicable} (epoch=${applicableEpoch.toString()})`
  );
  console.log(`lastKnownEpoch: ${clientSummary.lastKnownEpoch.toString()}`);
  console.log(
    "lastKnownPolicy:",
    clientSummary.lastKnownIds.map((id, i) => ({
      validatorId: id.toString(),
      weightBps: Number(clientSummary.lastKnownWeights[i]),
    }))
  );

  if (clientSummary.hasApplicable) {
    console.log(
      "applicablePolicy:",
      clientSummary.applicablePolicyIds.map((id, i) => ({
        validatorId: id.toString(),
        weightBps: Number(clientSummary.applicablePolicyWeights[i]),
      }))
    );
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
