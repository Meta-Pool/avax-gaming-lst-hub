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

  if (network.name !== "beam_testnet") {
    throw new Error(
      `This script must run on beam_testnet. Current: ${network.name}`
    );
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account available. Check PRIVATE_KEY in .env");
  }

  // Get Teleporter messenger address for BEAM
  const teleporterMessenger =
    process.env.TELEPORTER_MESSENGER_BEAM ||
    process.env.TELEPORTER_MESSENGER_BEAM_TESTNET;

  if (!teleporterMessenger || !ethers.isAddress(teleporterMessenger)) {
    throw new Error(
      "TELEPORTER_MESSENGER_BEAM not set in .env. Required for cross-chain communication."
    );
  }

  // Get C-Chain ID
  const cchainId = process.env.CCHAIN_ID || "43113"; // Fuji testnet default

  // Get PolicyServer address from C-Chain deployments or env
  const policyServerAddress =
    process.env.POLICY_SERVER_ADDRESS ||
    deployments?.networks?.cchain_testnet?.contracts?.policyServer?.address;

  if (!policyServerAddress || !ethers.isAddress(policyServerAddress)) {
    console.log("\n⚠️  WARNING: PolicyServer address not found!");
    console.log("You need to deploy PolicyServer on C-Chain first:");
    console.log("  npx hardhat run scripts/deploy_policy_server.js --network cchain_testnet");
    console.log("\nDeploying PolicyClient without request target configuration...");
  }

  console.log("=".repeat(70));
  console.log("🚀 DEPLOY POLICY CLIENT ON BEAM");
  console.log("=".repeat(70));
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Teleporter Messenger: ${teleporterMessenger}`);
  console.log(`C-Chain ID: ${cchainId}`);
  console.log(`PolicyServer (C-Chain): ${policyServerAddress || "NOT SET"}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} BEAM`);
  console.log("=".repeat(70));

  // Check if real PolicyClient already deployed
  const existingClient =
    deployments?.networks?.beam_testnet?.contracts?.policyClient?.address;
  const existingType =
    deployments?.networks?.beam_testnet?.contracts?.policyClient?.type;

  if (
    existingClient &&
    ethers.isAddress(existingClient) &&
    existingType === "PolicyClient"
  ) {
    console.log(`\n⚠️  Real PolicyClient already deployed at: ${existingClient}`);
    console.log("To redeploy, remove it from deployments.json first.");

    const client = await ethers.getContractAt("PolicyClient", existingClient);
    const messenger = await client.teleporterMessenger();
    const targetChain = await client.requestTargetChainId();
    const targetSender = await client.requestTargetSender();

    console.log("\nCurrent configuration:");
    console.log(`  Teleporter: ${messenger}`);
    console.log(`  Request Target Chain: ${targetChain}`);
    console.log(`  Request Target Sender: ${targetSender}`);

    return;
  }

  if (existingType === "MockPolicyClient") {
    console.log("\n⚠️  MockPolicyClient detected at: ${existingClient}");
    console.log("This will deploy the REAL PolicyClient alongside it.");
    console.log("You can update the vault later to use the real client.");
  }

  console.log("\n📝 Deploying PolicyClient contract...");

  const clientFactory = await ethers.getContractFactory("PolicyClient");
  const policyClient = await clientFactory.deploy(
    teleporterMessenger,
    deployer.address // owner
  );

  console.log("⏳ Waiting for deployment...");
  await policyClient.waitForDeployment();

  const clientAddress = await policyClient.getAddress();
  console.log(`✅ PolicyClient deployed at: ${clientAddress}`);

  // Verify deployment
  console.log("\n🔍 Verifying deployment...");
  const [deployedMessenger, deployedOwner] = await Promise.all([
    policyClient.teleporterMessenger(),
    policyClient.owner(),
  ]);

  console.log("Verification:");
  console.log(`  Teleporter: ${deployedMessenger}`);
  console.log(`  Owner: ${deployedOwner}`);

  if (
    deployedMessenger.toLowerCase() !== teleporterMessenger.toLowerCase() ||
    deployedOwner.toLowerCase() !== deployer.address.toLowerCase()
  ) {
    throw new Error("Deployment verification failed - addresses don't match");
  }

  // Configure request target if PolicyServer is available
  let requestTargetSet = false;
  let allowedSourceSet = false;

  if (policyServerAddress && ethers.isAddress(policyServerAddress)) {
    console.log("\n⚙️  Configuring request target...");

    try {
      const setTargetTx = await policyClient.setRequestTarget(
        BigInt(cchainId),
        policyServerAddress
      );
      await setTargetTx.wait();
      console.log("✅ Request target set");
      requestTargetSet = true;

      console.log("\n⚙️  Configuring allowed policy source...");
      const setSourceTx = await policyClient.setAllowedPolicySource(
        BigInt(cchainId),
        policyServerAddress,
        true
      );
      await setSourceTx.wait();
      console.log("✅ Allowed policy source set");
      allowedSourceSet = true;
    } catch (error) {
      console.log("⚠️  Configuration failed:", error.message);
    }
  }

  // Save to deployments.json
  console.log("\n💾 Saving to deployments.json...");

  if (!deployments.networks.beam_testnet) {
    deployments.networks.beam_testnet = { contracts: {} };
  }
  if (!deployments.networks.beam_testnet.contracts) {
    deployments.networks.beam_testnet.contracts = {};
  }

  // Save as realPolicyClient to preserve mock
  const clientKey = existingType === "MockPolicyClient" ? "realPolicyClient" : "policyClient";

  deployments.networks.beam_testnet.contracts[clientKey] = {
    address: clientAddress,
    type: "PolicyClient",
    teleporterMessenger: teleporterMessenger,
    owner: deployer.address,
  };

  if (requestTargetSet && policyServerAddress) {
    deployments.networks.beam_testnet.contracts[clientKey].requestTarget = {
      chainId: cchainId,
      address: policyServerAddress,
    };
  }

  if (allowedSourceSet && policyServerAddress) {
    deployments.networks.beam_testnet.contracts[clientKey].allowedSources = [
      {
        chainId: cchainId,
        address: policyServerAddress,
        allowed: true,
      },
    ];
  }

  writeDeployments(deploymentsPath, deployments);
  console.log("✅ Saved to deployments.json");

  console.log("\n" + "=".repeat(70));
  console.log("✅ POLICY CLIENT DEPLOYMENT COMPLETE");
  console.log("=".repeat(70));
  console.log("\n📋 Summary:");
  console.log(`  PolicyClient: ${clientAddress}`);
  console.log(`  Teleporter: ${teleporterMessenger}`);
  console.log(`  Owner: ${deployer.address}`);
  console.log(`  Request target: ${requestTargetSet ? "✅ Configured" : "❌ Not set"}`);
  console.log(`  Allowed source: ${allowedSourceSet ? "✅ Configured" : "❌ Not set"}`);

  console.log("\n💡 Next steps:");

  if (existingType === "MockPolicyClient") {
    console.log("  1. Update vault to use real PolicyClient:");
    console.log("     npx hardhat run scripts/update_vault_policy_client.js --network beam_testnet");
    console.log(`     (Set POLICY_CLIENT_ADDRESS=${clientAddress} in script or manually)`);
  }

  if (!requestTargetSet || !allowedSourceSet) {
    console.log("  2. Configure PolicyClient manually:");
    console.log("     - Set request target (C-Chain PolicyServer)");
    console.log("     - Set allowed policy source");
  }

  console.log("  3. Configure PolicyServer on C-Chain (Section 11.1):");
  console.log("     npx hardhat run scripts/set_policy_server_peers.js --network cchain_testnet");
  console.log("  4. Test cross-chain policy request");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
