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

function writeDeployments(filePath, data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  const { ethers, network } = hre;

  if (network.name !== "cchain_testnet") {
    throw new Error(
      `This script must run on cchain_testnet. Current: ${network.name}`
    );
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account available. Check PRIVATE_KEY in .env");
  }

  // Get PolicyGovernor address from deployments
  const policyGovernorAddress =
    process.env.POLICY_GOVERNOR_ADDRESS ||
    deployments?.networks?.cchain_testnet?.contracts?.policyGovernor?.address;

  if (!policyGovernorAddress || !ethers.isAddress(policyGovernorAddress)) {
    throw new Error(
      "PolicyGovernor address not found. Deploy it first with deploy_policy_governor.js"
    );
  }

  // Get Teleporter messenger address
  const teleporterMessenger =
    process.env.TELEPORTER_MESSENGER_CCHAIN ||
    process.env.TELEPORTER_MESSENGER_CCHAIN_TESTNET;

  if (!teleporterMessenger || !ethers.isAddress(teleporterMessenger)) {
    throw new Error(
      "TELEPORTER_MESSENGER_CCHAIN not set in .env. Required for cross-chain communication."
    );
  }

  console.log("=".repeat(70));
  console.log("🚀 DEPLOY POLICY SERVER ON C-CHAIN");
  console.log("=".repeat(70));
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`PolicyGovernor: ${policyGovernorAddress}`);
  console.log(`Teleporter Messenger: ${teleporterMessenger}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} AVAX`);
  console.log("=".repeat(70));

  // Check if PolicyServer already deployed
  const existingServer =
    deployments?.networks?.cchain_testnet?.contracts?.policyServer?.address;

  if (existingServer && ethers.isAddress(existingServer)) {
    console.log(`\n⚠️  PolicyServer already deployed at: ${existingServer}`);
    console.log("To redeploy, remove it from deployments.json first.");
    
    const server = await ethers.getContractAt("PolicyServer", existingServer);
    const governor = await server.policyGovernor();
    const messenger = await server.teleporterMessenger();
    
    console.log("\nCurrent configuration:");
    console.log(`  PolicyGovernor: ${governor}`);
    console.log(`  Teleporter: ${messenger}`);
    
    return;
  }

  console.log("\n📝 Deploying PolicyServer contract...");

  const serverFactory = await ethers.getContractFactory("PolicyServer");
  const policyServer = await serverFactory.deploy(
    teleporterMessenger,
    policyGovernorAddress,
    deployer.address // owner
  );

  console.log("⏳ Waiting for deployment...");
  await policyServer.waitForDeployment();

  const serverAddress = await policyServer.getAddress();
  console.log(`✅ PolicyServer deployed at: ${serverAddress}`);

  // Verify deployment
  console.log("\n🔍 Verifying deployment...");
  const [deployedGovernor, deployedMessenger, deployedOwner] = await Promise.all([
    policyServer.policyGovernor(),
    policyServer.teleporterMessenger(),
    policyServer.owner(),
  ]);

  console.log("Verification:");
  console.log(`  PolicyGovernor: ${deployedGovernor}`);
  console.log(`  Teleporter: ${deployedMessenger}`);
  console.log(`  Owner: ${deployedOwner}`);

  if (
    deployedGovernor.toLowerCase() !== policyGovernorAddress.toLowerCase() ||
    deployedMessenger.toLowerCase() !== teleporterMessenger.toLowerCase() ||
    deployedOwner.toLowerCase() !== deployer.address.toLowerCase()
  ) {
    throw new Error("Deployment verification failed - addresses don't match");
  }

  // Save to deployments.json
  console.log("\n💾 Saving to deployments.json...");

  if (!deployments.networks.cchain_testnet) {
    deployments.networks.cchain_testnet = { contracts: {} };
  }
  if (!deployments.networks.cchain_testnet.contracts) {
    deployments.networks.cchain_testnet.contracts = {};
  }

  deployments.networks.cchain_testnet.contracts.policyServer = {
    address: serverAddress,
    type: "PolicyServer",
    policyGovernor: policyGovernorAddress,
    teleporterMessenger: teleporterMessenger,
    owner: deployer.address,
  };

  writeDeployments(deploymentsPath, deployments);
  console.log("✅ Saved to deployments.json");

  console.log("\n" + "=".repeat(70));
  console.log("✅ POLICY SERVER DEPLOYMENT COMPLETE");
  console.log("=".repeat(70));
  console.log("\n📋 Summary:");
  console.log(`  PolicyServer: ${serverAddress}`);
  console.log(`  PolicyGovernor: ${policyGovernorAddress}`);
  console.log(`  Teleporter: ${teleporterMessenger}`);
  console.log(`  Owner: ${deployer.address}`);
  console.log("\n💡 Next steps:");
  console.log("  1. Update .env:");
  console.log(`     POLICY_SERVER_ADDRESS=${serverAddress}`);
  console.log("  2. Deploy PolicyClient on BEAM:");
  console.log("     npx hardhat run scripts/deploy_policy_client.js --network beam_testnet");
  console.log("  3. Configure cross-chain trust (Section 11.1)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
