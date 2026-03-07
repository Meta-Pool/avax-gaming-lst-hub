const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function getDeploymentsPath() {
  const custom = process.env.DEPLOYMENTS_FILE;
  return custom && custom.length > 0
    ? path.resolve(process.cwd(), custom)
    : path.resolve(process.cwd(), "deployments.json");
}

function readDeploymentsSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

async function main() {
  const { ethers, network } = hre;

  if (network.name !== "beam_testnet") {
    throw new Error(
      `This script is intended for beam_testnet. Current network: ${network.name}`
    );
  }

  // Get the address to check from command line args or env var or use signer
  let addressToCheck = process.env.CHECK_ADDRESS || process.argv[2];
  
  const [signer] = await ethers.getSigners();
  if (!addressToCheck) {
    if (!signer) {
      throw new Error("No signer available and no address provided");
    }
    addressToCheck = signer.address;
  }

  if (!ethers.isAddress(addressToCheck)) {
    throw new Error(`Invalid address: ${addressToCheck}`);
  }

  console.log("💰 BEAM NETWORK BALANCE CHECK");
  console.log("═".repeat(70));
  console.log(`Network: ${network.name}`);
  console.log(`Address: ${addressToCheck}`);
  console.log("═".repeat(70));

  // Get native BEAM balance
  const nativeBalance = await ethers.provider.getBalance(addressToCheck);
  console.log(`\n🔵 Native BEAM: ${ethers.formatEther(nativeBalance)} BEAM`);
  
  // Convert to different units for gas estimation context
  const nativeInGwei = Number(nativeBalance) / 1e9;
  console.log(`   (${nativeInGwei.toFixed(2)} Gwei)`);
  
  // Warning if balance is low
  const minRecommended = ethers.parseEther("0.01"); // 0.01 BEAM
  if (nativeBalance < minRecommended) {
    console.log(`   ⚠️  WARNING: Balance is low! Recommended minimum: 0.01 BEAM for gas`);
    console.log(`   📥 Need to fund this address with native BEAM tokens`);
  } else {
    console.log(`   ✅ Sufficient balance for transactions`);
  }

  // Try to get deployment addresses
  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeploymentsSafe(deploymentsPath);

  // Check WBEAM balance
  const wbeamAddress = deployments?.networks?.[network.name]?.contracts?.beamAsset?.address;
  if (wbeamAddress && ethers.isAddress(wbeamAddress)) {
    try {
      console.log(`\n🟡 WBEAM (Wrapped BEAM): ${wbeamAddress}`);
      const wbeam = await ethers.getContractAt("IERC20", wbeamAddress);
      const wbeamBalance = await wbeam.balanceOf(addressToCheck);
      
      // Try to get symbol and decimals with individual error handling
      let wbeamSymbol = "WBEAM";
      let wbeamDecimals = 18;
      
      try {
        wbeamSymbol = await wbeam.symbol();
      } catch (e) {
        // Symbol not available, use default
      }
      
      try {
        wbeamDecimals = await wbeam.decimals();
      } catch (e) {
        // Decimals not available, use default
      }
      
      console.log(`   Balance: ${ethers.formatUnits(wbeamBalance, wbeamDecimals)} ${wbeamSymbol}`);
      
      if (wbeamBalance === 0n) {
        console.log(`   💡 Tip: Wrap BEAM tokens to get WBEAM for vault deposits`);
      }
    } catch (error) {
      console.log(`   ❌ Error reading WBEAM balance: ${error.message}`);
    }
  } else {
    console.log(`\n🟡 WBEAM (Wrapped BEAM): Not deployed yet`);
    console.log(`   Run: npx hardhat run scripts/deploy_beam_vault.js --network beam_testnet`);
  }

  // Check stBEAM balance
  const vaultAddress = 
    deployments?.networks?.[network.name]?.contracts?.stBeamVault?.address ||
    deployments?.networks?.[network.name]?.contracts?.stBEAMVault?.address;
    
  if (vaultAddress && ethers.isAddress(vaultAddress)) {
    try {
      console.log(`\n🟢 stBEAM (Vault Shares): ${vaultAddress}`);
      const vault = await ethers.getContractAt("IERC20", vaultAddress);
      const stBeamBalance = await vault.balanceOf(addressToCheck);
      
      // Try to get symbol and decimals with individual error handling
      let stBeamSymbol = "stBEAM";
      let stBeamDecimals = 18;
      
      try {
        stBeamSymbol = await vault.symbol();
      } catch (e) {
        // Symbol not available, use default
      }
      
      try {
        stBeamDecimals = await vault.decimals();
      } catch (e) {
        // Decimals not available, use default
      }
      
      console.log(`   Balance: ${ethers.formatUnits(stBeamBalance, stBeamDecimals)} ${stBeamSymbol}`);
      
      if (stBeamBalance === 0n) {
        console.log(`   💡 Tip: Deposit WBEAM to get stBEAM shares`);
      } else {
        // Try to get the underlying asset value
        try {
          const vaultContract = await ethers.getContractAt("StBEAMVault", vaultAddress);
          const assetValue = await vaultContract.convertToAssets(stBeamBalance);
          console.log(`   Underlying value: ${ethers.formatUnits(assetValue, stBeamDecimals)} WBEAM`);
        } catch (e) {
          // Ignore if can't get asset value
        }
      }
    } catch (error) {
      console.log(`   ❌ Error reading stBEAM balance: ${error.message}`);
    }
  } else {
    console.log(`\n🟢 stBEAM (Vault Shares): Not deployed yet`);
    console.log(`   Run: npx hardhat run scripts/deploy_beam_vault.js --network beam_testnet`);
  }

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("📊 SUMMARY");
  console.log("─".repeat(70));
  
  const hasNative = nativeBalance >= minRecommended;
  const hasWbeam = wbeamAddress && ethers.isAddress(wbeamAddress);
  const hasVault = vaultAddress && ethers.isAddress(vaultAddress);
  
  if (!hasNative) {
    console.log("❌ Fund address with native BEAM tokens for gas");
    console.log(`   Current: ${ethers.formatEther(nativeBalance)} BEAM`);
    console.log(`   Needed: ~0.01 BEAM minimum`);
  } else if (!hasWbeam || !hasVault) {
    console.log("✅ Native BEAM balance sufficient for deployment");
    console.log("📝 Next step: Deploy vault contracts");
    console.log("   npx hardhat run scripts/deploy_beam_vault.js --network beam_testnet");
  } else {
    console.log("✅ All contracts deployed and ready");
    console.log("💡 You can now interact with the vault");
  }
  
  console.log("═".repeat(70));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
