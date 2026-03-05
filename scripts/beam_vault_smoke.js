const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function getDeploymentsPath() {
  const custom = process.env.DEPLOYMENTS_FILE;
  return custom && custom.length > 0
    ? path.resolve(process.cwd(), custom)
    : path.resolve(process.cwd(), "deployments.json");
}

function readDeployments() {
  const filePath = getDeploymentsPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`deployments file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function main() {
  const { ethers, network } = hre;
  if (network.name !== "beam_testnet") {
    throw new Error(`This script must run on beam_testnet. Current: ${network.name}`);
  }

  const deployments = readDeployments();
  const beamAssetAddress = deployments?.networks?.beam_testnet?.contracts?.beamAsset?.address;
  const vaultAddress = deployments?.networks?.beam_testnet?.contracts?.stBeamVault?.address;

  if (!ethers.isAddress(beamAssetAddress) || !ethers.isAddress(vaultAddress)) {
    throw new Error("Missing beamAsset/stBeamVault addresses in deployments.json");
  }

  const [user] = await ethers.getSigners();
  const asset = await ethers.getContractAt("BeamAssetMock", beamAssetAddress, user);
  const vault = await ethers.getContractAt("StBEAMVault", vaultAddress, user);

  const depositTokens = process.env.BEAM_VAULT_TEST_DEPOSIT || "10";
  const depositAssets = ethers.parseUnits(depositTokens, 18);
  const feeBps = await vault.DEPOSIT_FEE_BPS();
  const expectedFee = (depositAssets * feeBps) / 10000n;
  const expectedNet = depositAssets - expectedFee;

  const [bucketIdsBefore, bucketAmountsBefore] = await vault.getBuckets();
  const beforeMap = new Map();
  for (let i = 0; i < bucketIdsBefore.length; i += 1) {
    beforeMap.set(bucketIdsBefore[i].toString(), bucketAmountsBefore[i]);
  }

  let balance = await asset.balanceOf(user.address);
  if (balance < depositAssets) {
    const missing = depositAssets - balance;
    const mintTx = await asset.mint(user.address, missing);
    await mintTx.wait();
  }

  const approveTx = await asset.approve(vaultAddress, depositAssets);
  await approveTx.wait();

  const depositTx = await vault.deposit(depositAssets, user.address);
  const depositRcpt = await depositTx.wait();

  const feeAccumulatorAfterDeposit = await vault.feeAccumulator();
  const sharesAfterDeposit = await vault.balanceOf(user.address);

  const [bucketIdsAfter, bucketAmountsAfter] = await vault.getBuckets();
  const afterMap = new Map();
  for (let i = 0; i < bucketIdsAfter.length; i += 1) {
    afterMap.set(bucketIdsAfter[i].toString(), bucketAmountsAfter[i]);
  }

  let bucketDeltaSum = 0n;
  for (const [id, afterAmount] of afterMap.entries()) {
    const before = beforeMap.get(id) || 0n;
    bucketDeltaSum += afterAmount - before;
  }

  const maxWithdraw = await vault.maxWithdraw(user.address);
  if (maxWithdraw === 0n) {
    throw new Error("maxWithdraw is 0 after deposit");
  }

  const withdrawAssets = maxWithdraw / 2n > 0n ? maxWithdraw / 2n : maxWithdraw;
  const withdrawTx = await vault.withdraw(withdrawAssets, user.address, user.address);
  await withdrawTx.wait();

  const feeAccumulatorAfterWithdraw = await vault.feeAccumulator();
  const sharesAfterWithdraw = await vault.balanceOf(user.address);

  console.log(`deposit tx: ${depositRcpt.hash}`);
  console.log(`expected fee: ${expectedFee}`);
  console.log(`expected net distributed: ${expectedNet}`);
  console.log(`bucket delta sum: ${bucketDeltaSum}`);
  console.log(`feeAccumulator after deposit: ${feeAccumulatorAfterDeposit}`);
  console.log(`shares after deposit: ${sharesAfterDeposit}`);
  console.log(`withdraw assets: ${withdrawAssets}`);
  console.log(`feeAccumulator after withdraw: ${feeAccumulatorAfterWithdraw}`);
  console.log(`shares after withdraw: ${sharesAfterWithdraw}`);

  if (bucketDeltaSum !== expectedNet) {
    throw new Error(
      `bucket distribution mismatch: expected ${expectedNet}, got ${bucketDeltaSum}`
    );
  }

  console.log("beam vault smoke passed (deposit + withdraw + fee state + buckets)");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
