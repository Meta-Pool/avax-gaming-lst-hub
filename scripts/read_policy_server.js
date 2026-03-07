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

  if (network.name !== "cchain_testnet") {
    throw new Error(
      `This script should run on cchain_testnet. Current: ${network.name}`
    );
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);

  const policyServerAddress =
    process.env.POLICY_SERVER_ADDRESS ||
    deployments?.networks?.cchain_testnet?.contracts?.policyServer?.address;

  if (!policyServerAddress || !ethers.isAddress(policyServerAddress)) {
    throw new Error("PolicyServer address not found in deployments.json or env");
  }

  console.log("=".repeat(70));
  console.log("📋 POLICY SERVER STATUS");
  console.log("=".repeat(70));
  console.log(`Network: ${network.name}`);
  console.log(`Address: ${policyServerAddress}`);
  console.log("=".repeat(70));

  const policyServer = await ethers.getContractAt(
    "PolicyServer",
    policyServerAddress
  );

  // Read basic configuration
  const [teleporterMessenger, policyGovernor, owner] = await Promise.all([
    policyServer.teleporterMessenger(),
    policyServer.policyGovernor(),
    policyServer.owner(),
  ]);

  console.log("\n⚙️  Configuration:");
  console.log(`  Teleporter Messenger: ${teleporterMessenger}`);
  console.log(`  PolicyGovernor: ${policyGovernor}`);
  console.log(`  Owner: ${owner}`);

  // Try to read some allowed request sources
  console.log("\n🔐 Checking Allowed Request Sources:");
  
  const knownChains = [
    { name: "BEAM Testnet", id: 13337 },
    { name: "DFK Testnet", id: 335 },
  ];

  // Get potential client addresses from deployments
  const beamClientAddress =
    deployments?.networks?.beam_testnet?.contracts?.realPolicyClient?.address ||
    deployments?.networks?.beam_testnet?.contracts?.policyClient?.address;

  let foundSources = 0;

  for (const chain of knownChains) {
    if (chain.name === "BEAM Testnet" && beamClientAddress) {
      const isAllowed = await policyServer.allowedRequestSources(
        BigInt(chain.id),
        beamClientAddress
      );
      console.log(`  ${chain.name} (${chain.id}):`);
      console.log(`    Client: ${beamClientAddress}`);
      console.log(`    Allowed: ${isAllowed ? "✅ Yes" : "❌ No"}`);
      if (isAllowed) foundSources++;
    }
  }

  if (foundSources === 0) {
    console.log("  ⚠️  No allowed request sources configured yet");
    console.log("  Run: npx hardhat run scripts/set_policy_server_peers.js --network cchain_testnet");
  }

  // Try to read a policy from the governor
  console.log("\n📜 Testing PolicyGovernor Access:");
  try {
    const governor = await ethers.getContractAt(
      "PolicyGovernor",
      policyGovernor
    );

    const latestFinalizedEpoch = await governor.getLatestFinalizedEpoch();
    console.log(`  Latest Finalized Epoch: ${latestFinalizedEpoch}`);

    if (latestFinalizedEpoch > 0n) {
      const policy = await governor.getPolicy(latestFinalizedEpoch);
      console.log(`  Policy for epoch ${latestFinalizedEpoch}:`);
      policy.forEach((p) => {
        const bps = Number(p.weightBps);
        console.log(
          `    Validator ${p.validatorId}: ${bps} BPS (${(bps / 100).toFixed(2)}%)`
        );
      });
    } else {
      console.log("  ⚠️  No finalized policies yet");
    }
  } catch (error) {
    console.log("  ⚠️  Could not read PolicyGovernor:", error.message);
  }

  console.log("\n" + "=".repeat(70));
  console.log("✅ POLICY SERVER READ COMPLETE");
  console.log("=".repeat(70));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
