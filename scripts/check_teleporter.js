const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  console.log("======================================================================");
  console.log("🔍 CHECKING TELEPORTER MESSENGER");
  console.log("======================================================================");

  const [user] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(user.address);

  console.log(`Network: ${hre.network.name}`);
  console.log(`User: ${user.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)}`);
  console.log("======================================================================\n");

  const teleporterAddress = "0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf";
  console.log(`Teleporter Address: ${teleporterAddress}\n`);

  // Check if contract exists
  const code = await ethers.provider.getCode(teleporterAddress);
  console.log(`Contract exists: ${code !== "0x" ? "✅ YES" : "❌ NO"}`);
  console.log(`Code size: ${code.length} characters\n`);

  if (code === "0x") {
    console.log("❌ ERROR: Teleporter contract not deployed at this address!");
    console.log("   This might be a testnet issue or wrong address.");
    return;
  }

  // Try to check if it's a real Teleporter
  // The real Avalanche Teleporter has a different interface
  console.log("🔍 Checking Teleporter interface...\n");

  try {
    // Try the full Teleporter interface with fee struct
    const realTeleporterAbi = [
      "function sendCrossChainMessage(tuple(uint256 destinationBlockchainID, address destinationAddress, address feeInfo, uint256 requiredGasLimit, address[] allowedRelayerAddresses, bytes message) messageInput) external returns (bytes32 messageID)",
    ];

    const teleporter = new ethers.Contract(teleporterAddress, realTeleporterAbi, user);
    console.log("✅ Real Teleporter interface detected (with fee struct)");
    console.log("   This means cross-chain messages require fee configuration\n");

    console.log("📋 SOLUTION:");
    console.log("   The PolicyClient contract needs to be updated to handle");
    console.log("   Teleporter fees. The current implementation uses a simplified");
    console.log("   interface that doesn't include fee information.\n");

    console.log("   Options:");
    console.log("   1. Update PolicyClient to use the full Teleporter interface");
    console.log("   2. Deploy a MockTeleporterMessenger for testing");
    console.log("   3. Fund the PolicyClient with gas tokens for Teleporter fees");

  } catch (error) {
    console.log("ℹ️  Could not confirm full Teleporter interface");
    console.log(`   Error: ${error.message}\n`);

    // Try simple interface
    try {
      const simpleTeleporterAbi = [
        "function sendCrossChainMessage(uint256 destinationChainId, address destinationAddress, bytes calldata message) external returns (bytes32 messageId)",
      ];

      const teleporter = new ethers.Contract(teleporterAddress, simpleTeleporterAbi, user);
      console.log("✅ Simple Teleporter interface detected");
      console.log("   This might be a mock or simplified version\n");

    } catch (error2) {
      console.log("❌ Could not detect any known Teleporter interface");
      console.log(`   Error: ${error2.message}`);
    }
  }

  console.log("======================================================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
