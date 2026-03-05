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

function getFromDeployments(deployments, networkName) {
  const contracts = deployments?.networks?.[networkName]?.contracts || {};
  return (
    contracts.policyGovernor?.address ||
    contracts.policyGovernor ||
    contracts.governor?.address ||
    contracts.governor ||
    ""
  );
}

function asBigInt(value, fallback = 0n) {
  try {
    return BigInt(value);
  } catch (_) {
    return fallback;
  }
}

async function main() {
  const { ethers, network } = hre;
  const args = parseArgs();
  const deployments = readDeploymentsSafe(args.deployments);

  const addrCandidate =
    args.policyGovernor ||
    process.env.POLICY_GOVERNOR_ADDRESS ||
    getFromDeployments(deployments, network.name);

  if (!addrCandidate || !ethers.isAddress(addrCandidate)) {
    throw new Error(
      `PolicyGovernor address not found. Use --policyGovernor, POLICY_GOVERNOR_ADDRESS, or deployments.json under networks.${network.name}.contracts.policyGovernor`
    );
  }

  const governorAddress = ethers.getAddress(addrCandidate);
  const governor = await ethers.getContractAt("PolicyGovernor", governorAddress);

  const [
    chain,
    epochSeconds,
    startTimestamp,
    quorumMode,
    quorumValue,
    currentEpoch,
    applicableEpoch,
    latestFinalizedEpoch,
    validatorIds,
  ] = await Promise.all([
    ethers.provider.getNetwork(),
    governor.EPOCH_SECONDS(),
    governor.START_TIMESTAMP(),
    governor.quorumMode(),
    governor.quorumValue(),
    governor.getCurrentEpoch(),
    governor.getApplicableEpoch(),
    governor.getLatestFinalizedEpoch(),
    governor.getValidatorIds(),
  ]);

  const epochInput = args.epoch || process.env.READ_POLICY_EPOCH;
  const epochToRead = epochInput
    ? asBigInt(epochInput)
    : asBigInt(latestFinalizedEpoch);

  let finalized = false;
  let voters = 0n;
  let participatedVp = 0n;
  let policyRows = [];
  let sumBps = 0;

  if (epochToRead > 0n) {
    finalized = await governor.isEpochFinalized(epochToRead);
    if (finalized) {
      [voters, participatedVp] = await Promise.all([
        governor.votersByEpoch(epochToRead),
        governor.totalVotingPowerByEpoch(epochToRead),
      ]);

      const policy = await governor.getPolicy(epochToRead);
      policyRows = policy.map((row) => {
        const id = row.validatorId ?? row[0];
        const weightBps = Number(row.weightBps ?? row[1]);
        sumBps += weightBps;
        return { validatorId: id.toString(), weightBps };
      });
    }
  }

  console.log("=== C-CHAIN POLICY STATE ===");
  console.log(`network: ${network.name}`);
  console.log(`chainId: ${chain.chainId.toString()}`);
  console.log(`policyGovernor: ${governorAddress}`);
  console.log(`EPOCH_SECONDS: ${epochSeconds.toString()}`);
  console.log(`START_TIMESTAMP: ${startTimestamp.toString()}`);
  console.log(`quorumMode: ${Number(quorumMode) === 0 ? "ABSOLUTE" : "BPS"}`);
  console.log(`quorumValue: ${quorumValue.toString()}`);
  console.log(`currentEpoch: ${currentEpoch.toString()}`);
  console.log(`applicableEpoch (epoch-1): ${applicableEpoch.toString()}`);
  console.log(`latestFinalizedEpoch: ${latestFinalizedEpoch.toString()}`);
  console.log(`validatorIds: ${validatorIds.map((x) => x.toString()).join(",")}`);

  if (epochToRead === 0n) {
    console.log("epochRead: 0 (no finalized epoch yet)");
    return;
  }

  console.log(`epochRead: ${epochToRead.toString()}`);
  console.log(`epochFinalized: ${finalized}`);

  if (!finalized) {
    console.log("policy: <not finalized>");
    return;
  }

  console.log(`votersByEpoch: ${voters.toString()}`);
  console.log(`totalVotingPowerByEpoch: ${participatedVp.toString()}`);
  console.log("policy:");
  for (const p of policyRows) {
    console.log(`  - validatorId=${p.validatorId} weightBps=${p.weightBps}`);
  }
  console.log(`policySumBps: ${sumBps}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
