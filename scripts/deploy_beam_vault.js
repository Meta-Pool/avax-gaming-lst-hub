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

  console.log("═".repeat(70));
  console.log("🚀 BEAM VAULT DEPLOYMENT");
  console.log("═".repeat(70));
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} BEAM`);
  console.log("═".repeat(70));

  const depositFeeBps = Number(process.env.DEPOSIT_FEE_BPS || "100");
  if (!Number.isInteger(depositFeeBps) || depositFeeBps < 0 || depositFeeBps >= 10000) {
    throw new Error("DEPOSIT_FEE_BPS must be an integer in [0, 9999]");
  }

  const chainId = (await ethers.provider.getNetwork()).chainId;
  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);

  if (!deployments.networks[network.name]) {
    deployments.networks[network.name] = {};
  }
  deployments.networks[network.name].chainId = chainId.toString();

  // Helper function to save deployments incrementally
  function saveDeployments() {
    deployments.updatedAt = new Date().toISOString();
    fs.writeFileSync(deploymentsPath, `${JSON.stringify(deployments, null, 2)}\n`);
  }

  // Step 1: Deploy or get WBEAM asset
  console.log("\n📦 Step 1/3: Deploy WBEAM Asset");
  console.log("─".repeat(70));
  
  let assetInfo;
  const existingAsset = deployments.networks[network.name].contracts?.beamAsset?.address;
  if (existingAsset && ethers.isAddress(existingAsset)) {
    console.log(`✅ Using existing WBEAM asset: ${existingAsset}`);
    assetInfo = { address: existingAsset, deployed: false };
  } else {
    assetInfo = await deployMockAssetIfNeeded(deployer);
    
    // Save immediately after successful deployment
    deployments.networks[network.name].contracts = {
      ...(deployments.networks[network.name].contracts || {}),
      beamAsset: {
        address: assetInfo.address,
        type: assetInfo.deployed ? "BeamAssetMock" : "external",
        ...(assetInfo.name ? { name: assetInfo.name } : {}),
        ...(assetInfo.symbol ? { symbol: assetInfo.symbol } : {}),
      },
    };
    saveDeployments();
    console.log(`✅ WBEAM asset deployed: ${assetInfo.address}`);
    console.log(`📝 Saved to deployments.json`);
  }

  const balanceAfterAsset = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance after asset: ${ethers.formatEther(balanceAfterAsset)} BEAM`);

  // Step 2: Deploy or get PolicyClient
  console.log("\n📦 Step 2/3: Deploy Policy Client");
  console.log("─".repeat(70));
  
  let policyClientInfo;
  const existingClient = deployments.networks[network.name].contracts?.policyClient?.address;
  if (existingClient && ethers.isAddress(existingClient)) {
    console.log(`✅ Using existing PolicyClient: ${existingClient}`);
    policyClientInfo = { address: existingClient, deployed: false };
  } else {
    policyClientInfo = await deployMockPolicyClientIfNeeded();
    
    // Save immediately after successful deployment
    deployments.networks[network.name].contracts = {
      ...(deployments.networks[network.name].contracts || {}),
      policyClient: {
        address: policyClientInfo.address,
        type: policyClientInfo.deployed ? "MockPolicyClient" : "external",
      },
    };
    saveDeployments();
    console.log(`✅ PolicyClient deployed: ${policyClientInfo.address}`);
    console.log(`📝 Saved to deployments.json`);
  }

  const balanceAfterClient = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance after client: ${ethers.formatEther(balanceAfterClient)} BEAM`);

  // Step 3: Deploy Vault
  console.log("\n📦 Step 3/3: Deploy stBEAM Vault");
  console.log("─".repeat(70));
  
  const existingVault = 
    deployments.networks[network.name].contracts?.stBeamVault?.address ||
    deployments.networks[network.name].contracts?.stBEAMVault?.address;
    
  if (existingVault && ethers.isAddress(existingVault)) {
    console.log(`✅ Vault already deployed: ${existingVault}`);
    console.log(`⚠️  To redeploy, remove the vault entry from deployments.json`);
    return;
  }

  const policyEpochSeconds = Number(process.env.POLICY_EPOCH_SECONDS || "60");
  const policyStartTimestamp = BigInt(process.env.POLICY_START_TIMESTAMP || "0");

  console.log(`Deploying vault with:`);
  console.log(`  Asset: ${assetInfo.address}`);
  console.log(`  PolicyClient: ${policyClientInfo.address}`);
  console.log(`  DepositFee: ${depositFeeBps} BPS`);

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

  // Save vault deployment
  deployments.networks[network.name].contracts = {
    ...(deployments.networks[network.name].contracts || {}),
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
  };
  saveDeployments();
  console.log(`✅ stBEAMVault deployed: ${vaultAddress}`);
  console.log(`📝 Saved to deployments.json`);

  const finalBalance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Final balance: ${ethers.formatEther(finalBalance)} BEAM`);

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("✅ DEPLOYMENT COMPLETE");
  console.log("═".repeat(70));
  console.log(`WBEAM Asset: ${assetInfo.address}`);
  console.log(`PolicyClient: ${policyClientInfo.address}`);
  console.log(`stBEAMVault: ${vaultAddress}`);
  console.log(`Deposit Fee: ${depositFeeBps} BPS (${depositFeeBps / 100}%)`);
  console.log(`\n📝 All addresses saved to: ${deploymentsPath}`);
  console.log(`💸 Total gas spent: ${ethers.formatEther(balance - finalBalance)} BEAM`);
  console.log("═".repeat(70));
}

main().catch((error) => {
  console.error("\n❌ DEPLOYMENT FAILED");
  console.error("═".repeat(70));
  console.error(error.message || error);
  console.error("\n💡 Note: Any successfully deployed contracts have been saved.");
  console.error("   Re-run this script to continue from where it failed.");
  console.error("═".repeat(70));
  process.exitCode = 1;
});
