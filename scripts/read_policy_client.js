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
      `This script should run on beam_testnet. Current: ${network.name}`
    );
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);

  // Prioritize realPolicyClient over mock policyClient
  const realPolicyClientAddress =
    deployments?.networks?.beam_testnet?.contracts?.realPolicyClient?.address;
  const realPolicyClientType =
    deployments?.networks?.beam_testnet?.contracts?.realPolicyClient?.type;

  const mockPolicyClientAddress =
    deployments?.networks?.beam_testnet?.contracts?.policyClient?.address;
  const mockPolicyClientType =
    deployments?.networks?.beam_testnet?.contracts?.policyClient?.type;

  const policyClientAddress = realPolicyClientAddress || mockPolicyClientAddress;
  const policyClientType = realPolicyClientAddress
    ? realPolicyClientType || "PolicyClient"
    : mockPolicyClientType || "PolicyClient";

  if (!policyClientAddress || !ethers.isAddress(policyClientAddress)) {
    throw new Error("policyClient address not found in deployments.json");
  }

  console.log("=".repeat(70));
  console.log("📋 POLICY CLIENT STATUS");
  console.log("=".repeat(70));
  console.log(`Network: ${network.name}`);
  console.log(`Address: ${policyClientAddress}`);
  console.log(`Type: ${policyClientType}`);
  
  if (realPolicyClientAddress) {
    console.log(`✅ Using REAL PolicyClient (cross-chain enabled)`);
  } else {
    console.log(`⚠️  Using MockPolicyClient (testing only)`);
  }
  console.log("=".repeat(70));

  // Try to connect based on type
  let policyClient;
  if (policyClientType === "MockPolicyClient") {
    policyClient = await ethers.getContractAt(
      "MockPolicyClient",
      policyClientAddress
    );
  } else {
    policyClient = await ethers.getContractAt(
      "PolicyClient",
      policyClientAddress
    );
  }

  // Read common fields
  const lastKnownEpoch = await policyClient.lastKnownEpoch();
  console.log(`\n📊 Last Known Epoch: ${lastKnownEpoch}`);

  if (lastKnownEpoch > 0n) {
    console.log("\n📜 Last Known Policy:");

    try {
      const [epoch, ids, weights] = await policyClient.getLastKnownPolicy();
      console.log(`  Epoch: ${epoch}`);
      console.log(`  Validators: ${ids.length}`);

      let totalBps = 0;
      ids.forEach((id, i) => {
        const bps = Number(weights[i]);
        const pct = (bps / 100).toFixed(2);
        console.log(`    Validator ${id}: ${bps} BPS (${pct}%)`);
        totalBps += bps;
      });
      console.log(`  Total: ${totalBps} BPS (${(totalBps / 100).toFixed(2)}%)`);
    } catch (err) {
      console.log("  ⚠️  Could not read last known policy");
    }
  } else {
    console.log("  ⚠️  No policy set yet");
  }

  // Check if this is a real PolicyClient with cross-chain config
  if (policyClientType !== "MockPolicyClient") {
    try {
      const teleporterMessenger = await policyClient.teleporterMessenger();
      const requestTargetChainId = await policyClient.requestTargetChainId();
      const requestTargetSender = await policyClient.requestTargetSender();

      console.log("\n🌐 Cross-Chain Configuration:");
      console.log(`  Teleporter Messenger: ${teleporterMessenger}`);
      console.log(`  Request Target Chain ID: ${requestTargetChainId}`);
      console.log(`  Request Target Sender: ${requestTargetSender}`);

      if (requestTargetSender === ethers.ZeroAddress) {
        console.log("  ⚠️  Request target not configured");
      }
    } catch (err) {
      console.log("\n⚠️  This appears to be a MockPolicyClient (no cross-chain config)");
    }
  } else {
    console.log("\n🧪 This is a MockPolicyClient (testing mode)");
    console.log("   - No cross-chain communication");
    console.log("   - Policy set manually with setPolicy()");
    console.log("   - Use update_mock_policy.js to change policy");
  }

  // Check all stored policies
  console.log("\n📚 Checking stored policies for recent epochs...");
  let foundCount = 0;
  for (let i = 0; i <= 10; i++) {
    try {
      const hasPolicy = await policyClient.hasPolicyForEpoch(BigInt(i));
      if (hasPolicy) {
        const [ids, weights] = await policyClient.getPolicy(BigInt(i));
        console.log(`  Epoch ${i}: ${ids.length} validators`);
        foundCount++;
      }
    } catch (err) {
      // Skip epochs without policy
    }
  }

  if (foundCount === 0) {
    console.log("  No policies found for epochs 0-10");
  }

  console.log("=".repeat(70));
  console.log("✅ POLICY CLIENT READ COMPLETE");
  console.log("=".repeat(70));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
