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
      `This script should run on beam_testnet. Current: ${network.name}`
    );
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);

  const vaultAddress =
    deployments?.networks?.beam_testnet?.contracts?.stBeamVault?.address;

  // Allow user to specify which client to use via environment variable
  // USE_MOCK_CLIENT=true prioritizes mock, otherwise uses real if available
  const useMock = process.env.USE_MOCK_CLIENT === "true";
  
  const realPolicyClientAddress =
    deployments?.networks?.beam_testnet?.contracts?.realPolicyClient?.address;
  const mockPolicyClientAddress =
    deployments?.networks?.beam_testnet?.contracts?.policyClient?.address;

  let policyClientAddress;
  let clientType;
  
  if (useMock) {
    // Prioritize mock when explicitly requested
    policyClientAddress = mockPolicyClientAddress || realPolicyClientAddress;
    clientType = mockPolicyClientAddress ? "MockPolicyClient" : "PolicyClient (REAL)";
  } else {
    // Default: prioritize real client for production
    policyClientAddress = realPolicyClientAddress || mockPolicyClientAddress;
    clientType = realPolicyClientAddress ? "PolicyClient (REAL)" : "MockPolicyClient";
  }

  if (!vaultAddress || !ethers.isAddress(vaultAddress)) {
    throw new Error("stBeamVault address not found in deployments.json");
  }

  if (!policyClientAddress || !ethers.isAddress(policyClientAddress)) {
    throw new Error("No policyClient address found in deployments.json");
  }

  const [deployer] = await ethers.getSigners();

  console.log("=".repeat(70));
  console.log("🔄 UPDATE VAULT POLICY CLIENT");
  console.log("=".repeat(70));
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Vault: ${vaultAddress}`);
  console.log(`New PolicyClient: ${policyClientAddress}`);
  console.log(`Client Type: ${clientType}`);
  console.log(`USE_MOCK_CLIENT: ${useMock ? 'true (forcing mock)' : 'false (prefer real)'}`);

  if (clientType === "PolicyClient (REAL)") {
    console.log(`✅ Using REAL PolicyClient (cross-chain enabled)`);
  } else {
    console.log(`⚠️  Using MockPolicyClient (testing/demo mode)`);
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} BEAM`);
  console.log("=".repeat(70));

  const vault = await ethers.getContractAt("StBEAMVault", vaultAddress, deployer);

  // Check current policy client
  const currentPolicyClient = await vault.policyClient();
  console.log(`\n📊 Current PolicyClient in Vault: ${currentPolicyClient}`);

  if (currentPolicyClient.toLowerCase() === policyClientAddress.toLowerCase()) {
    console.log("✅ PolicyClient is already set correctly. No update needed.");
    return;
  }

  console.log(`\n⚠️  Mismatch detected!`);
  console.log(`   Vault has:  ${currentPolicyClient}`);
  console.log(`   Should be:  ${policyClientAddress}`);

  // Check if deployer is owner
  const owner = await vault.owner();
  console.log(`\n🔑 Vault Owner: ${owner}`);

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `Deployer ${deployer.address} is not the vault owner. Owner is ${owner}`
    );
  }

  console.log(`\n🔄 Updating PolicyClient...`);

  const tx = await vault.setPolicyClient(policyClientAddress);
  console.log(`Transaction sent: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);

  // Verify the change
  const newPolicyClient = await vault.policyClient();
  console.log(`\n✅ New PolicyClient in Vault: ${newPolicyClient}`);

  if (newPolicyClient.toLowerCase() !== policyClientAddress.toLowerCase()) {
    throw new Error("PolicyClient update failed - verification mismatch");
  }

  // Update deployments.json
  deployments.networks.beam_testnet.contracts.stBeamVault.policyClient =
    policyClientAddress;
  writeDeployments(deploymentsPath, deployments);

  console.log(`\n✅ Updated deployments.json`);
  console.log("=".repeat(70));
  console.log("✅ VAULT POLICY CLIENT UPDATE COMPLETE");
  console.log("=".repeat(70));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
