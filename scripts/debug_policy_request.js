const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  console.log("======================================================================");
  console.log("🔍 DEBUG POLICY REQUEST - COMPREHENSIVE CHECK");
  console.log("======================================================================");

  const [user] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(user.address);

  console.log(`Network: ${hre.network.name}`);
  console.log(`User: ${user.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} BEAM/AVAX`);
  console.log("======================================================================\n");

  // Read deployments
  const fs = require("fs");
  const path = require("path");
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  // Get PolicyClient
  const realPolicyClientAddress = deployments?.networks?.beam_testnet?.contracts?.realPolicyClient?.address;
  const mockPolicyClientAddress = deployments?.networks?.beam_testnet?.contracts?.MockPolicyClient?.address;
  const policyClientAddress = realPolicyClientAddress || mockPolicyClientAddress;

  if (!policyClientAddress) {
    throw new Error("PolicyClient not found in deployments.json");
  }

  console.log(`📋 PolicyClient Address: ${policyClientAddress}`);
  console.log(`   Type: ${realPolicyClientAddress ? "REAL PolicyClient" : "MockPolicyClient"}\n`);

  const policyClient = await ethers.getContractAt("PolicyClient", policyClientAddress);

  // Get vault
  const vaultAddress = deployments?.networks?.beam_testnet?.contracts?.stBeamVault?.address;
  if (!vaultAddress) {
    throw new Error("Vault not found in deployments.json (looking for 'stBeamVault')");
  }
  console.log(`🏦 Vault Address: ${vaultAddress}\n`);

  const vault = await ethers.getContractAt("StBEAMVault", vaultAddress);

  // ===== 1. CHECK POLICYCLIENT CONFIGURATION =====
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("1️⃣  POLICYCLIENT CONFIGURATION (BEAM)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const teleporterAddress = await policyClient.teleporterMessenger();
  console.log(`Teleporter Messenger: ${teleporterAddress}`);

  const requestTargetChain = await policyClient.requestTargetChainId();
  const requestTargetAddress = await policyClient.requestTargetSender();
  console.log(`Request Target: Chain ${requestTargetChain} → ${requestTargetAddress}`);

  const expectedServerAddress = deployments?.networks?.cchain_testnet?.contracts?.policyServer?.address;
  console.log(`Expected Server: ${expectedServerAddress}`);
  
  if (requestTargetAddress.toLowerCase() !== expectedServerAddress?.toLowerCase()) {
    console.log("⚠️  WARNING: Request target does not match deployed PolicyServer!");
  } else {
    console.log("✅ Request target matches PolicyServer");
  }

  // Check allowed sources
  const cchainId = process.env.CCHAIN_ID || "43113";
  const isSourceAllowed = await policyClient.allowedPolicySources(cchainId, requestTargetAddress);
  console.log(`Allowed Source (Chain ${cchainId}, ${requestTargetAddress}): ${isSourceAllowed ? "✅ YES" : "❌ NO"}`);

  const lastKnownEpoch = await policyClient.lastKnownEpoch();
  console.log(`Last Known Epoch: ${lastKnownEpoch}`);

  // ===== 2. CHECK WHAT EPOCH TO REQUEST =====
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("2️⃣  EPOCH DETERMINATION");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const applicableEpoch = await vault.getApplicablePolicyEpoch();
  console.log(`Vault Applicable Epoch: ${applicableEpoch}`);

  const hasPolicy = await policyClient.hasPolicyForEpoch(applicableEpoch);
  console.log(`PolicyClient has policy for epoch ${applicableEpoch}: ${hasPolicy ? "YES" : "NO"}`);

  // ===== 3. CHECK TELEPORTER MESSENGER =====
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("3️⃣  TELEPORTER MESSENGER CHECK");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const expectedTeleporter = "0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf";
  console.log(`Expected: ${expectedTeleporter}`);
  console.log(`Actual:   ${teleporterAddress}`);
  console.log(`Match: ${teleporterAddress.toLowerCase() === expectedTeleporter.toLowerCase() ? "✅ YES" : "❌ NO"}`);

  // ===== 4. TRY TO ESTIMATE GAS AND GET REVERT REASON =====
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("4️⃣  ATTEMPTING TO GET REVERT REASON");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    console.log(`Calling: policyClient.requestPolicy(${applicableEpoch}, ${vaultAddress})`);
    
    // Try to call statically first to get the revert reason
    await policyClient["requestPolicy(uint256,address)"].staticCall(applicableEpoch, vaultAddress);
    console.log("✅ Static call succeeded - transaction should work!");
  } catch (error) {
    console.log("❌ Static call failed with error:");
    console.log(error.message);
    
    // Try to decode the error
    if (error.data) {
      console.log(`\nError data: ${error.data}`);
      
      // Try to decode common errors
      try {
        const iface = new ethers.Interface([
          "error Unauthorized()",
          "error InvalidInput()",
          "error PolicyNotFound(uint256)",
          "error AlreadyExists()",
        ]);
        const decoded = iface.parseError(error.data);
        console.log("Decoded error:", decoded);
      } catch (decodeError) {
        console.log("Could not decode error with known signatures");
      }
    }

    // Try to extract revert reason from the error
    if (error.error && error.error.message) {
      console.log(`\nUnderlying error message: ${error.error.message}`);
    }

    // Try alternate signature without vault
    console.log("\n🔄 Trying without vault address...");
    try {
      await policyClient["requestPolicy(uint256)"].staticCall(applicableEpoch);
      console.log("✅ Static call WITHOUT vault succeeded!");
    } catch (error2) {
      console.log("❌ Also fails without vault address");
      console.log(error2.message);
    }
  }

  // ===== 5. CHECK CALLER PERMISSIONS =====
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("5️⃣  CALLER PERMISSIONS");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  console.log(`Caller (you): ${user.address}`);
  
  // Check if there's an owner restriction
  try {
    const owner = await policyClient.owner();
    console.log(`PolicyClient owner: ${owner}`);
    console.log(`Owner match: ${owner.toLowerCase() === user.address.toLowerCase() ? "✅ YES" : "❌ NO (but requestPolicy might be public)"}`);
  } catch (e) {
    console.log("No owner() function (OK if requestPolicy is public)");
  }

  // ===== 6. CHECK REQUEST TARGET CONFIGURATION =====
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("6️⃣  REQUEST TARGET VALIDATION");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (requestTargetChain.toString() === "0" || requestTargetAddress === ethers.ZeroAddress) {
    console.log("❌ ERROR: Request target not configured!");
    console.log("   You need to run: npx hardhat run scripts/deploy_policy_client.js --network beam_testnet");
  } else {
    console.log(`✅ Request target configured: Chain ${requestTargetChain} → ${requestTargetAddress}`);
  }

  // ===== 7. CHECK VAULT'S POLICY CLIENT =====
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("7️⃣  VAULT CONFIGURATION");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const vaultPolicyClient = await vault.policyClient();
  console.log(`Vault's PolicyClient: ${vaultPolicyClient}`);
  console.log(`Matches current client: ${vaultPolicyClient.toLowerCase() === policyClientAddress.toLowerCase() ? "✅ YES" : "❌ NO"}`);

  if (vaultPolicyClient.toLowerCase() !== policyClientAddress.toLowerCase()) {
    console.log("⚠️  Vault is using a different PolicyClient!");
    console.log(`   You may need to update it with: npx hardhat run scripts/update_vault_policy_client.js --network beam_testnet`);
  }

  // ===== SUMMARY =====
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 SUMMARY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const checks = [
    { name: "PolicyClient has request target", pass: requestTargetChain.toString() !== "0" && requestTargetAddress !== ethers.ZeroAddress },
    { name: "Request target matches server", pass: requestTargetAddress.toLowerCase() === expectedServerAddress?.toLowerCase() },
    { name: "Teleporter address correct", pass: teleporterAddress.toLowerCase() === expectedTeleporter.toLowerCase() },
    { name: "Source allowed in client", pass: isSourceAllowed },
    { name: "Vault uses this client", pass: vaultPolicyClient.toLowerCase() === policyClientAddress.toLowerCase() },
  ];

  console.log("");
  checks.forEach(check => {
    console.log(`${check.pass ? "✅" : "❌"} ${check.name}`);
  });

  const allPassed = checks.every(c => c.pass);
  if (!allPassed) {
    console.log("\n❌ Some checks failed - see details above");
  } else {
    console.log("\n✅ All configuration checks passed!");
    console.log("   The issue might be on the PolicyServer side (C-Chain)");
    console.log("   Run: npx hardhat run scripts/read_policy_server.js --network cchain_testnet");
  }

  console.log("\n======================================================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
