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
      `deployments file not found: ${filePath}. Run deploy_voting_power.js first.`
    );
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function getVotingPowerAddress(deployments, networkName) {
  const { ethers } = hre;
  const addr = deployments?.networks?.[networkName]?.contracts?.votingPower?.proxy;
  if (!addr || !ethers.isAddress(addr)) {
    throw new Error(
      `votingPower proxy address missing in deployments for network ${networkName}`
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

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account available. Check PRIVATE_KEY in .env");
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);
  const votingPowerAddress = getVotingPowerAddress(deployments, network.name);

  // Configuration from environment variables with sensible defaults
  // Epoch duration: default 7 days (604800 seconds) for testing
  const epochSeconds = process.env.EPOCH_SECONDS 
    ? Number(process.env.EPOCH_SECONDS)
    : 604800;

  // Quorum mode: default to BPS (basis points)
  const useQuorumBps = process.env.QUORUM_MODE 
    ? process.env.QUORUM_MODE.toLowerCase() === "bps"
    : true;

  // Quorum value: default to 5000 BPS (50%) if BPS mode, or 1000 if absolute
  const quorumValue = process.env.QUORUM_VALUE
    ? Number(process.env.QUORUM_VALUE)
    : useQuorumBps ? 5000 : 1000;

  // Validator IDs: comma-separated string, or empty for default [1,2,3,4]
  const validatorIdsStr = process.env.VALIDATOR_IDS || "";
  const validatorIds = validatorIdsStr
    ? validatorIdsStr.split(",").map((id) => BigInt(id.trim()))
    : [];

  console.log("Deploying PolicyGovernor with configuration:");
  console.log(`  VotingPower: ${votingPowerAddress}`);
  console.log(`  Epoch Duration: ${epochSeconds} seconds (${epochSeconds / 86400} days)`);
  console.log(`  Quorum Mode: ${useQuorumBps ? "BPS" : "ABSOLUTE"}`);
  console.log(`  Quorum Value: ${quorumValue}`);
  console.log(`  Validator IDs: ${validatorIds.length > 0 ? validatorIds.join(",") : "[default: 1,2,3,4]"}`);
  console.log("─".repeat(70));

  const governorFactory = await ethers.getContractFactory("PolicyGovernor");
  const governor = await governorFactory.deploy(
    votingPowerAddress,
    epochSeconds,
    useQuorumBps,
    quorumValue,
    validatorIds
  );
  await governor.waitForDeployment();
  const governorAddress = await governor.getAddress();

  // Verify deployment
  const [
    boundVotingPower,
    deployedEpochSeconds,
    startTimestamp,
    deployedQuorumMode,
    deployedQuorumValue,
    deployedValidatorIds,
  ] = await Promise.all([
    governor.votingPower(),
    governor.EPOCH_SECONDS(),
    governor.START_TIMESTAMP(),
    governor.quorumMode(),
    governor.quorumValue(),
    governor.getValidatorIds(),
  ]);

  if (boundVotingPower.toLowerCase() !== votingPowerAddress.toLowerCase()) {
    throw new Error(
      `VotingPower mismatch: expected ${votingPowerAddress}, got ${boundVotingPower}`
    );
  }

  console.log("✅ PolicyGovernor deployed successfully!");
  console.log(`\nDeployment details:`);
  console.log(`  Address: ${governorAddress}`);
  console.log(`  Voting Power: ${boundVotingPower}`);
  console.log(`  Epoch Seconds: ${deployedEpochSeconds}`);
  console.log(`  Start Timestamp: ${startTimestamp} (${new Date(Number(startTimestamp) * 1000).toISOString()})`);
  console.log(`  Quorum Mode: ${Number(deployedQuorumMode) === 0 ? "ABSOLUTE" : "BPS"}`);
  console.log(`  Quorum Value: ${deployedQuorumValue}`);
  console.log(`  Validator IDs: ${deployedValidatorIds.map(id => id.toString()).join(",")}`);

  const chainId = (await ethers.provider.getNetwork()).chainId;

  if (!deployments.networks[network.name]) {
    deployments.networks[network.name] = {};
  }

  deployments.networks[network.name].chainId = chainId.toString();
  deployments.networks[network.name].contracts = {
    ...(deployments.networks[network.name].contracts || {}),
    policyGovernor: {
      address: governorAddress,
      votingPower: votingPowerAddress,
      epochSeconds: epochSeconds.toString(),
      startTimestamp: startTimestamp.toString(),
      quorumMode: useQuorumBps ? "BPS" : "ABSOLUTE",
      quorumValue: quorumValue.toString(),
      validatorIds: deployedValidatorIds.map(id => id.toString()),
    },
  };
  deployments.updatedAt = new Date().toISOString();

  fs.writeFileSync(deploymentsPath, `${JSON.stringify(deployments, null, 2)}\n`);

  console.log(`\n✅ Deployment saved to: ${deploymentsPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
