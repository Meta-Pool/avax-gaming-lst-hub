const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function getDeploymentsPath() {
  const custom = process.env.DEPLOYMENTS_FILE;
  return custom && custom.length > 0
    ? path.resolve(process.cwd(), custom)
    : path.resolve(process.cwd(), "deployments.json");
}

function requireAddress(value, field) {
  const { ethers } = hre;
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`Invalid or missing address for ${field}`);
  }
  return value;
}

function readMpDaoAddress(filePath, currentNetwork) {
  const { ethers } = hre;

  if (!fs.existsSync(filePath)) {
    throw new Error(`deployments file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  const addr = data?.networks?.[currentNetwork]?.contracts?.mpdao?.address;
  if (!addr || !ethers.isAddress(addr)) {
    throw new Error(
      `mpdao address missing in deployments for network ${currentNetwork}`
    );
  }

  return addr;
}

async function main() {
  const { ethers, network } = hre;

  if (network.name !== "cchain_testnet") {
    throw new Error(
      `This script is intended for cchain_testnet. Current network: ${network.name}`
    );
  }

  const deploymentsPath = getDeploymentsPath();

  const to1 = requireAddress(process.env.MINT_ACCOUNT_1, "MINT_ACCOUNT_1");
  const to2 = requireAddress(process.env.MINT_ACCOUNT_2, "MINT_ACCOUNT_2");

  // Amounts are provided as whole-token strings (e.g. "1000"), converted to 6-decimal units.
  const amount1 = ethers.parseUnits(process.env.MINT_AMOUNT_1 || "1000", 6);
  const amount2 = ethers.parseUnits(process.env.MINT_AMOUNT_2 || "1000", 6);

  const tokenAddress = readMpDaoAddress(deploymentsPath, network.name);
  const [minter] = await ethers.getSigners();
  if (!minter) {
    throw new Error("No signer available. Check PRIVATE_KEY in .env");
  }

  const token = await ethers.getContractAt("MpDaoToken", tokenAddress, minter);

  console.log(`mpDAO: ${tokenAddress}`);
  console.log(`minter: ${minter.address}`);
  console.log(`mint -> ${to1}: ${ethers.formatUnits(amount1, 6)} mpDAO`);
  const tx1 = await token.mint(to1, amount1);
  await tx1.wait();

  console.log(`mint -> ${to2}: ${ethers.formatUnits(amount2, 6)} mpDAO`);
  const tx2 = await token.mint(to2, amount2);
  await tx2.wait();

  const [balance1, balance2] = await Promise.all([
    token.balanceOf(to1),
    token.balanceOf(to2),
  ]);

  console.log(`balanceOf(${to1}) = ${ethers.formatUnits(balance1, 6)} mpDAO`);
  console.log(`balanceOf(${to2}) = ${ethers.formatUnits(balance2, 6)} mpDAO`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
