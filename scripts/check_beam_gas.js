const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;

  if (network.name !== "beam_testnet") {
    throw new Error(`This script is for beam_testnet. Current: ${network.name}`);
  }

  const [deployer] = await ethers.getSigners();
  console.log("⛽ GAS PRICE CHECK - BEAM TESTNET");
  console.log("═".repeat(70));
  console.log(`Deployer: ${deployer.address}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} BEAM`);
  
  // Get current gas price
  const feeData = await ethers.provider.getFeeData();
  console.log("\n📊 Current Gas Prices:");
  console.log(`Gas Price: ${ethers.formatUnits(feeData.gasPrice || 0n, "gwei")} Gwei`);
  if (feeData.maxFeePerGas) {
    console.log(`Max Fee Per Gas: ${ethers.formatUnits(feeData.maxFeePerGas, "gwei")} Gwei`);
  }
  if (feeData.maxPriorityFeePerGas) {
    console.log(`Max Priority Fee: ${ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei")} Gwei`);
  }

  // Estimate gas for contract deployments
  console.log("\n📐 Gas Estimates:");
  console.log("─".repeat(70));

  try {
    const mockPolicyFactory = await ethers.getContractFactory("MockPolicyClient");
    const deployTx = await mockPolicyFactory.getDeployTransaction();
    const gasEstimate = await ethers.provider.estimateGas(deployTx);
    const gasCost = gasEstimate * (feeData.gasPrice || 0n);
    
    console.log(`MockPolicyClient:`);
    console.log(`  Gas Units: ${gasEstimate.toString()}`);
    console.log(`  Estimated Cost: ${ethers.formatEther(gasCost)} BEAM`);
  } catch (e) {
    console.log(`MockPolicyClient: ⚠️  Could not estimate (${e.message})`);
  }

  try {
    const vaultFactory = await ethers.getContractFactory("StBEAMVault");
    // Need to provide constructor args for estimate
    const dummyAsset = "0x244AfCd5a0bc8A4400c6702C6a2A7717945c5e70"; // Your WBEAM
    const dummyClient = ethers.ZeroAddress;
    const deployTx = await vaultFactory.getDeployTransaction(
      dummyAsset,
      100, // depositFeeBps
      deployer.address,
      dummyClient,
      60, // epochSeconds
      0 // startTimestamp
    );
    const gasEstimate = await ethers.provider.estimateGas(deployTx);
    const gasCost = gasEstimate * (feeData.gasPrice || 0n);
    
    console.log(`StBEAMVault:`);
    console.log(`  Gas Units: ${gasEstimate.toString()}`);
    console.log(`  Estimated Cost: ${ethers.formatEther(gasCost)} BEAM`);
  } catch (e) {
    console.log(`StBEAMVault: ⚠️  Could not estimate (${e.message})`);
  }

  console.log("\n" + "═".repeat(70));
  console.log("⚠️  NOTE: Actual costs may vary. Gas prices can fluctuate.");
  console.log("💡 TIP: If gas prices are extremely high, wait and try later.");
  console.log("═".repeat(70));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
