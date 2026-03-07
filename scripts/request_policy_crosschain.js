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
      `This script must run on beam_testnet. Current: ${network.name}`
    );
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);

  // Get real PolicyClient address
  const policyClientAddress =
    deployments?.networks?.beam_testnet?.contracts?.realPolicyClient?.address ||
    deployments?.networks?.beam_testnet?.contracts?.policyClient?.address;

  const vaultAddress =
    process.env.VAULT_ADDRESS ||
    deployments?.networks?.beam_testnet?.contracts?.stBeamVault?.address;

  if (!policyClientAddress || !ethers.isAddress(policyClientAddress)) {
    throw new Error("PolicyClient address not found in deployments.json");
  }

  const [user] = await ethers.getSigners();

  console.log("=".repeat(70));
  console.log("🌐 REQUEST POLICY CROSS-CHAIN");
  console.log("=".repeat(70));
  console.log(`Network: ${network.name}`);
  console.log(`User: ${user.address}`);
  console.log(`PolicyClient: ${policyClientAddress}`);
  console.log(`Vault: ${vaultAddress || "Not specified"}`);

  const balance = await ethers.provider.getBalance(user.address);
  console.log(`Balance: ${ethers.formatEther(balance)} BEAM`);
  console.log("=".repeat(70));

  const policyClient = await ethers.getContractAt(
    "PolicyClient",
    policyClientAddress,
    user
  );

  // Get vault to determine which epoch to request
  let epochToRequest;

  if (vaultAddress && ethers.isAddress(vaultAddress)) {
    try {
      const vault = await ethers.getContractAt("StBEAMVault", vaultAddress);
      epochToRequest = await vault.getApplicablePolicyEpoch();
      console.log(`\n📅 Vault's applicable epoch: ${epochToRequest}`);
    } catch (error) {
      console.log("\n⚠️  Could not read vault's applicable epoch");
      epochToRequest = BigInt(process.env.REQUEST_POLICY_EPOCH || "1");
      console.log(`Using epoch from env/default: ${epochToRequest}`);
    }
  } else {
    epochToRequest = BigInt(process.env.REQUEST_POLICY_EPOCH || "1");
    console.log(`\n📅 Requesting epoch: ${epochToRequest} (from env/default)`);
  }

  // Check current state
  const [lastKnownEpoch, hasPolicy] = await Promise.all([
    policyClient.lastKnownEpoch(),
    policyClient.hasPolicyForEpoch(epochToRequest),
  ]);

  console.log(`\n📊 Current State:`);
  console.log(`  Last known epoch in client: ${lastKnownEpoch}`);
  console.log(`  Has policy for epoch ${epochToRequest}: ${hasPolicy}`);

  if (hasPolicy) {
    console.log(`\n✅ Policy for epoch ${epochToRequest} already exists!`);
    const [ids, weights] = await policyClient.getPolicy(epochToRequest);
    console.log(`  Validators: ${ids.length}`);
    ids.forEach((id, i) => {
      const bps = Number(weights[i]);
      console.log(`    Validator ${id}: ${bps} BPS (${(bps / 100).toFixed(2)}%)`);
    });
    return;
  }

  // Request policy
  console.log(`\n🚀 Requesting policy for epoch ${epochToRequest}...`);
  console.log("This will send a Teleporter message to C-Chain PolicyServer");

  let tx;
  if (vaultAddress && ethers.isAddress(vaultAddress)) {
    console.log(`Including vault address in request: ${vaultAddress}`);
    tx = await policyClient["requestPolicy(uint256,address)"](epochToRequest, vaultAddress);
  } else {
    tx = await policyClient["requestPolicy(uint256)"](epochToRequest);
  }

  console.log(`\n⏳ Transaction sent: ${tx.hash}`);
  console.log("Waiting for confirmation...");

  const receipt = await tx.wait();
  console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);

  // Try to extract messageId from events
  let messageId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = policyClient.interface.parseLog(log);
      if (parsed && parsed.name === "PolicyRequested") {
        messageId = parsed.args.messageId;
        console.log(`\n📨 Teleporter Message ID: ${messageId}`);
        break;
      }
    } catch (_) {
      // Not a PolicyRequested event
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("✅ POLICY REQUEST SENT");
  console.log("=".repeat(70));
  console.log("\n⏰ Waiting for Teleporter Relayers...");
  console.log("This usually takes 30 seconds to 2 minutes.");
  console.log("\nThe flow is:");
  console.log("  1. Your request → Teleporter on BEAM");
  console.log("  2. Relayer picks up message");
  console.log("  3. Relayer delivers to C-Chain PolicyServer");
  console.log("  4. PolicyServer reads policy from PolicyGovernor");
  console.log("  5. PolicyServer sends response → Teleporter");
  console.log("  6. Relayer picks up response");
  console.log("  7. Relayer delivers to BEAM PolicyClient");
  console.log("  8. PolicyClient stores the policy");

  console.log("\n💡 Check if policy arrived:");
  console.log("  npx hardhat run scripts/read_policy_client.js --network beam_testnet");
  
  if (messageId) {
    console.log("\n🔍 Track your message:");
    console.log(`  Message ID: ${messageId}`);
    console.log("  BEAM Testnet Teleporter Explorer:");
    console.log("  https://testnet.snowtrace.io/");
  }

  console.log("\n⏳ Waiting 30 seconds before checking...");
  await new Promise((resolve) => setTimeout(resolve, 30000));

  console.log("\n🔍 Checking if policy arrived...");
  const hasPolicyNow = await policyClient.hasPolicyForEpoch(epochToRequest);

  if (hasPolicyNow) {
    console.log("✅ Policy received!");
    const [ids, weights] = await policyClient.getPolicy(epochToRequest);
    console.log(`  Validators: ${ids.length}`);
    ids.forEach((id, i) => {
      const bps = Number(weights[i]);
      console.log(`    Validator ${id}: ${bps} BPS (${(bps / 100).toFixed(2)}%)`);
    });
  } else {
    console.log("⏳ Policy not arrived yet. Keep checking:");
    console.log("  npx hardhat run scripts/read_policy_client.js --network beam_testnet");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
