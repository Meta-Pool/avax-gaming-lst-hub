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

  const vaultAddress =
    deployments?.networks?.beam_testnet?.contracts?.stBeamVault?.address;
  const assetAddress =
    deployments?.networks?.beam_testnet?.contracts?.beamAsset?.address;

  if (!vaultAddress || !ethers.isAddress(vaultAddress)) {
    throw new Error("stBeamVault address not found in deployments.json");
  }

  if (!assetAddress || !ethers.isAddress(assetAddress)) {
    throw new Error("beamAsset address not found in deployments.json");
  }

  const [user] = await ethers.getSigners();

  // Get amount to stake from env or use default
  const stakeTokens = process.env.STAKE_BEAM_AMOUNT || "100";
  const stakeAmount = ethers.parseUnits(stakeTokens, 18);

  console.log("=".repeat(70));
  console.log("💰 STAKE WBEAM INTO VAULT");
  console.log("=".repeat(70));
  console.log(`Network: ${network.name}`);
  console.log(`User: ${user.address}`);
  console.log(`Vault: ${vaultAddress}`);
  console.log(`Asset (WBEAM): ${assetAddress}`);
  console.log(`Amount to stake: ${stakeTokens} WBEAM`);

  const balance = await ethers.provider.getBalance(user.address);
  console.log(`User balance: ${ethers.formatEther(balance)} BEAM`);
  console.log("=".repeat(70));

  const asset = await ethers.getContractAt("BeamAssetMock", assetAddress, user);
  const vault = await ethers.getContractAt("StBEAMVault", vaultAddress, user);

  // Check and mint WBEAM if needed
  console.log("\n📊 Checking WBEAM balance...");
  let wbeamBalance = await asset.balanceOf(user.address);
  console.log(`Current WBEAM balance: ${ethers.formatUnits(wbeamBalance, 18)}`);

  if (wbeamBalance < stakeAmount) {
    const needed = stakeAmount - wbeamBalance;
    console.log(`\n🪙 Minting ${ethers.formatUnits(needed, 18)} WBEAM...`);
    const mintTx = await asset.mint(user.address, needed);
    await mintTx.wait();
    console.log(`✅ Minted WBEAM`);
    wbeamBalance = await asset.balanceOf(user.address);
  }

  // Get vault state BEFORE deposit
  console.log("\n📊 Vault state BEFORE deposit:");
  const totalAssetsBefore = await vault.totalAssets();
  const totalSupplyBefore = await vault.totalSupply();
  const userSharesBefore = await vault.balanceOf(user.address);
  const feeAccumulatorBefore = await vault.feeAccumulator();
  const [bucketIdsBefore, bucketAmountsBefore] = await vault.getBuckets();
  
  console.log(`  Total assets: ${ethers.formatUnits(totalAssetsBefore, 18)} WBEAM`);
  console.log(`  Total supply: ${ethers.formatUnits(totalSupplyBefore, 18)} stBEAM`);
  console.log(`  Your shares: ${ethers.formatUnits(userSharesBefore, 18)} stBEAM`);
  console.log(`  Fee accumulator: ${ethers.formatUnits(feeAccumulatorBefore, 18)} WBEAM`);
  console.log(`  Buckets: ${bucketIdsBefore.length} validators`);
  bucketIdsBefore.forEach((id, i) => {
    console.log(`    Validator ${id}: ${ethers.formatUnits(bucketAmountsBefore[i], 18)} WBEAM`);
  });

  // Approve WBEAM to vault
  console.log(`\n✅ Approving ${stakeTokens} WBEAM to vault...`);
  const approveTx = await asset.approve(vaultAddress, stakeAmount);
  await approveTx.wait();
  console.log("✅ Approval confirmed");

  // Deposit (stake) into vault
  console.log(`\n💰 Depositing ${stakeTokens} WBEAM into vault...`);
  const depositTx = await vault.deposit(stakeAmount, user.address);
  const depositReceipt = await depositTx.wait();
  console.log(`✅ Deposit confirmed in block ${depositReceipt.blockNumber}`);
  console.log(`Transaction: ${depositReceipt.hash}`);

  // Check for events
  console.log("\n📢 Events emitted:");
  let policyAppliedCount = 0;
  let bucketsUpdatedCount = 0;
  let feeChargedAmount = 0n;

  for (const log of depositReceipt.logs) {
    if (log.address.toLowerCase() !== vaultAddress.toLowerCase()) continue;
    
    try {
      const parsed = vault.interface.parseLog(log);
      if (parsed) {
        console.log(`  - ${parsed.name}`);
        if (parsed.name === "PolicyApplied") policyAppliedCount++;
        if (parsed.name === "BucketsUpdated") bucketsUpdatedCount++;
        if (parsed.name === "FeeCharged") {
          feeChargedAmount = parsed.args.feeAssets;
        }
      }
    } catch (_) {
      // Ignore non-matching logs
    }
  }

  // Get vault state AFTER deposit
  console.log("\n📊 Vault state AFTER deposit:");
  const totalAssetsAfter = await vault.totalAssets();
  const totalSupplyAfter = await vault.totalSupply();
  const userSharesAfter = await vault.balanceOf(user.address);
  const feeAccumulatorAfter = await vault.feeAccumulator();
  const [bucketIdsAfter, bucketAmountsAfter] = await vault.getBuckets();
  
  console.log(`  Total assets: ${ethers.formatUnits(totalAssetsAfter, 18)} WBEAM`);
  console.log(`  Total supply: ${ethers.formatUnits(totalSupplyAfter, 18)} stBEAM`);
  console.log(`  Your shares: ${ethers.formatUnits(userSharesAfter, 18)} stBEAM`);
  console.log(`  Fee accumulator: ${ethers.formatUnits(feeAccumulatorAfter, 18)} WBEAM`);
  console.log(`  Buckets: ${bucketIdsAfter.length} validators`);

  // Calculate fee
  const feeBps = await vault.DEPOSIT_FEE_BPS();
  const expectedFee = (stakeAmount * feeBps) / 10000n;
  const expectedNet = stakeAmount - expectedFee;
  const actualFee = feeAccumulatorAfter - feeAccumulatorBefore;

  console.log("\n💵 Fee calculation:");
  console.log(`  Deposit amount: ${ethers.formatUnits(stakeAmount, 18)} WBEAM`);
  console.log(`  Fee rate: ${feeBps} BPS (${Number(feeBps) / 100}%)`);
  console.log(`  Expected fee: ${ethers.formatUnits(expectedFee, 18)} WBEAM`);
  console.log(`  Actual fee: ${ethers.formatUnits(actualFee, 18)} WBEAM`);
  console.log(`  Net to distribute: ${ethers.formatUnits(expectedNet, 18)} WBEAM`);

  // Calculate bucket changes
  console.log("\n📦 Bucket changes:");
  const bucketMap = new Map();
  
  bucketIdsBefore.forEach((id, i) => {
    bucketMap.set(id.toString(), {
      before: bucketAmountsBefore[i],
      after: 0n,
      delta: 0n
    });
  });

  bucketIdsAfter.forEach((id, i) => {
    const idStr = id.toString();
    const before = bucketMap.get(idStr)?.before || 0n;
    const after = bucketAmountsAfter[i];
    const delta = after - before;
    bucketMap.set(idStr, { before, after, delta });
  });

  let totalDelta = 0n;
  for (const [id, data] of bucketMap.entries()) {
    if (data.delta > 0n) {
      console.log(`  Validator ${id}:`);
      console.log(`    Before: ${ethers.formatUnits(data.before, 18)} WBEAM`);
      console.log(`    After:  ${ethers.formatUnits(data.after, 18)} WBEAM`);
      console.log(`    Delta:  +${ethers.formatUnits(data.delta, 18)} WBEAM`);
      totalDelta += data.delta;
    }
  }

  console.log(`\n  Total distributed: ${ethers.formatUnits(totalDelta, 18)} WBEAM`);

  // Verify distribution
  console.log("\n✅ Verification:");
  console.log(`  Expected to distribute: ${ethers.formatUnits(expectedNet, 18)} WBEAM`);
  console.log(`  Actually distributed:   ${ethers.formatUnits(totalDelta, 18)} WBEAM`);
  
  if (totalDelta === expectedNet) {
    console.log("  ✅ Distribution matches expected amount!");
  } else {
    console.log("  ⚠️  Distribution mismatch!");
  }

  if (actualFee === expectedFee) {
    console.log("  ✅ Fee matches expected amount!");
  } else {
    console.log("  ⚠️  Fee mismatch!");
  }

  if (policyAppliedCount > 0) {
    console.log("  ✅ PolicyApplied event emitted");
  }

  if (bucketsUpdatedCount > 0) {
    console.log("  ✅ BucketsUpdated event emitted");
  }

  const sharesReceived = userSharesAfter - userSharesBefore;
  console.log(`\n🎁 You received ${ethers.formatUnits(sharesReceived, 18)} stBEAM shares!`);

  console.log("=".repeat(70));
  console.log("✅ STAKING COMPLETE");
  console.log("=".repeat(70));
  console.log("\n💡 Next steps:");
  console.log("  1. Run: npx hardhat run scripts/verify_policy_distribution.js --network beam_testnet");
  console.log("  2. Check: npx hardhat run scripts/read_beam_vault_and_buckets.js --network beam_testnet");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
