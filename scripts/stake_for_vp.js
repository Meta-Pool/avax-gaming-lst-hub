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
    throw new Error(`deployments file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function requireAddress(value, field) {
  const { ethers } = hre;
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`Invalid or missing address for ${field}`);
  }
  return value;
}

async function main() {
  const { ethers, network } = hre;

  if (network.name !== "cchain_testnet") {
    throw new Error(
      `This script is intended for cchain_testnet. Current network: ${network.name}`
    );
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);

  const mpdaoAddress = requireAddress(
    deployments?.networks?.[network.name]?.contracts?.mpdao?.address,
    "deployments.networks.<network>.contracts.mpdao.address"
  );

  const votingPowerProxy = requireAddress(
    deployments?.networks?.[network.name]?.contracts?.votingPower?.proxy,
    "deployments.networks.<network>.contracts.votingPower.proxy"
  );

  const [userASigner] = await ethers.getSigners();
  if (!userASigner) {
    throw new Error("No signer available. Check PRIVATE_KEY in .env");
  }

  const userA = userASigner.address;
  const userB =
    process.env.USER_B_ADDRESS && ethers.isAddress(process.env.USER_B_ADDRESS)
      ? process.env.USER_B_ADDRESS
      : ethers.Wallet.createRandom().address;

  const lockDays = Number(process.env.STAKE_LOCK_DAYS || "30");
  if (Number.isNaN(lockDays) || lockDays < 30 || lockDays > 300) {
    throw new Error("STAKE_LOCK_DAYS must be a number between 30 and 300");
  }

  const stakeAmountTokens = process.env.STAKE_AMOUNT || "1000";
  const stakeAmount = ethers.parseUnits(stakeAmountTokens, 6);

  const mpdao = await ethers.getContractAt("MpDaoToken", mpdaoAddress, userASigner);
  const votingPower = await ethers.getContractAt(
    "VotingPowerV1",
    votingPowerProxy,
    userASigner
  );

  const balanceA = await mpdao.balanceOf(userA);
  if (balanceA < stakeAmount) {
    const mintAmount = stakeAmount - balanceA;
    console.log(
      `User A balance too low. Minting ${ethers.formatUnits(mintAmount, 6)} mpDAO to ${userA}`
    );
    const mintTx = await mpdao.mint(userA, mintAmount);
    await mintTx.wait();
  }

  const allowance = await mpdao.allowance(userA, votingPowerProxy);
  if (allowance < stakeAmount) {
    const approveTx = await mpdao.approve(votingPowerProxy, stakeAmount);
    await approveTx.wait();
  }

  const stakeTx = await votingPower.createLockedPosition(lockDays, stakeAmount);
  await stakeTx.wait();

  const [vpA, vpB] = await Promise.all([
    votingPower.getVotingPower(userA),
    votingPower.getVotingPower(userB),
  ]);

  console.log(`userA: ${userA}`);
  console.log(`userB: ${userB}`);
  console.log(`vp(userA): ${vpA}`);
  console.log(`vp(userB): ${vpB}`);

  if (vpA <= 0n) {
    throw new Error("DoD failed: user A VP is not > 0");
  }

  if (vpB !== 0n) {
    throw new Error("DoD failed: user B VP is not 0");
  }

  console.log("DoD check passed: user A VP > 0 and user B VP = 0");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
