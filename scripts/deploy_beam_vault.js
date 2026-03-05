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
    return { updatedAt: new Date().toISOString(), networks: {} };
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function requireNetwork(name) {
  if (hre.network.name !== name) {
    throw new Error(`This script must run on ${name}. Current: ${hre.network.name}`);
  }
}

async function deployMockAssetIfNeeded(deployer) {
  const { ethers } = hre;

  if (process.env.BEAM_ASSET_ADDRESS && ethers.isAddress(process.env.BEAM_ASSET_ADDRESS)) {
    return {
      address: process.env.BEAM_ASSET_ADDRESS,
      deployed: false,
    };
  }

  const name = process.env.BEAM_ASSET_NAME || "Wrapped BEAM Mock";
  const symbol = process.env.BEAM_ASSET_SYMBOL || "WBEAM";
  const initialSupplyTokens = process.env.BEAM_ASSET_INITIAL_SUPPLY || "1000000";
  const initialSupply = ethers.parseUnits(initialSupplyTokens, 18);

  const factory = await ethers.getContractFactory("BeamAssetMock");
  const asset = await factory.deploy(name, symbol, deployer.address, initialSupply);
  await asset.waitForDeployment();

  return {
    address: await asset.getAddress(),
    deployed: true,
    name,
    symbol,
  };
}

function parseUintArray(value, fallbackCsv) {
  const raw = (value && value.length > 0 ? value : fallbackCsv).split(",");
  return raw.map((v) => BigInt(v.trim()));
}

function parseUint16Array(value, fallbackCsv) {
  const raw = (value && value.length > 0 ? value : fallbackCsv).split(",");
  return raw.map((v) => Number(v.trim()));
}

async function deployMockPolicyClientIfNeeded() {
  const { ethers } = hre;

  if (process.env.POLICY_CLIENT_ADDRESS && ethers.isAddress(process.env.POLICY_CLIENT_ADDRESS)) {
    return {
      address: process.env.POLICY_CLIENT_ADDRESS,
      deployed: false,
    };
  }

  const factory = await ethers.getContractFactory("MockPolicyClient");
  const policyClient = await factory.deploy();
  await policyClient.waitForDeployment();

  const defaultEpoch = BigInt(process.env.MOCK_POLICY_EPOCH || "1");
  const validatorIds = parseUintArray(
    process.env.MOCK_POLICY_VALIDATOR_IDS,
    "1,2,3,4"
  );
  const weights = parseUint16Array(
    process.env.MOCK_POLICY_WEIGHTS_BPS,
    "2500,2500,2500,2500"
  );

  const tx = await policyClient.setPolicy(defaultEpoch, validatorIds, weights);
  await tx.wait();

  return {
    address: await policyClient.getAddress(),
    deployed: true,
  };
}

async function main() {
  const { ethers, network } = hre;
  requireNetwork("beam_testnet");

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account available. Check PRIVATE_KEY in .env");
  }

  const depositFeeBps = Number(process.env.DEPOSIT_FEE_BPS || "100");
  if (!Number.isInteger(depositFeeBps) || depositFeeBps < 0 || depositFeeBps >= 10000) {
    throw new Error("DEPOSIT_FEE_BPS must be an integer in [0, 9999]");
  }

  const assetInfo = await deployMockAssetIfNeeded(deployer);
  const policyClientInfo = await deployMockPolicyClientIfNeeded();
  const policyEpochSeconds = Number(process.env.POLICY_EPOCH_SECONDS || "60");
  const policyStartTimestamp = BigInt(process.env.POLICY_START_TIMESTAMP || "0");

  const vaultFactory = await ethers.getContractFactory("StBEAMVault");
  const vault = await vaultFactory.deploy(
    assetInfo.address,
    depositFeeBps,
    deployer.address,
    policyClientInfo.address,
    policyEpochSeconds,
    policyStartTimestamp
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  const chainId = (await ethers.provider.getNetwork()).chainId;
  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);

  if (!deployments.networks[network.name]) {
    deployments.networks[network.name] = {};
  }

  deployments.networks[network.name].chainId = chainId.toString();
  deployments.networks[network.name].contracts = {
    ...(deployments.networks[network.name].contracts || {}),
    beamAsset: {
      address: assetInfo.address,
      type: assetInfo.deployed ? "BeamAssetMock" : "external",
      ...(assetInfo.name ? { name: assetInfo.name } : {}),
      ...(assetInfo.symbol ? { symbol: assetInfo.symbol } : {}),
    },
    stBeamVault: {
      address: vaultAddress,
      asset: assetInfo.address,
      policyClient: policyClientInfo.address,
      policyEpochSeconds,
      policyStartTimestamp: policyStartTimestamp.toString(),
      depositFeeBps,
      feeMode: "on_deposited_amount",
      shareSymbol: "stBEAM",
    },
    policyClient: {
      address: policyClientInfo.address,
      type: policyClientInfo.deployed ? "MockPolicyClient" : "external",
    },
  };
  deployments.updatedAt = new Date().toISOString();

  fs.writeFileSync(deploymentsPath, `${JSON.stringify(deployments, null, 2)}\n`);

  console.log(`beam asset: ${assetInfo.address} (${assetInfo.deployed ? "deployed" : "provided"})`);
  console.log(
    `policy client: ${policyClientInfo.address} (${policyClientInfo.deployed ? "deployed" : "provided"})`
  );
  console.log(`stBEAMVault deployed at: ${vaultAddress}`);
  console.log(`deposit fee mode: on_deposited_amount (${depositFeeBps} bps)`);
  console.log(`deployments saved to: ${deploymentsPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
