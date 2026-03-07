const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function getDeploymentsPath() {
  const custom = process.env.DEPLOYMENTS_FILE;
  return custom && custom.length > 0
    ? path.resolve(process.cwd(), custom)
    : path.resolve(process.cwd(), "deployments.json");
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
  const tokenAddress = readMpDaoAddress(deploymentsPath, network.name);

  // Get the address to check from command line args or env var
  const addressToCheck = process.env.CHECK_ADDRESS || process.argv[2];
  
  if (!addressToCheck) {
    throw new Error(
      "Please provide an address to check. Use: CHECK_ADDRESS=0x... or pass as argument"
    );
  }

  if (!ethers.isAddress(addressToCheck)) {
    throw new Error(`Invalid address: ${addressToCheck}`);
  }

  // Just need a provider, no signer required for read-only operations
  const token = await ethers.getContractAt("MpDaoToken", tokenAddress);

  console.log(`mpDAO Token: ${tokenAddress}`);
  console.log(`Checking balance for: ${addressToCheck}`);
  console.log("─".repeat(60));

  const [balance, totalSupply, decimals, name, symbol] = await Promise.all([
    token.balanceOf(addressToCheck),
    token.totalSupply(),
    token.decimals(),
    token.name(),
    token.symbol(),
  ]);

  console.log(`Token Name: ${name}`);
  console.log(`Token Symbol: ${symbol}`);
  console.log(`Decimals: ${decimals}`);
  console.log("─".repeat(60));
  console.log(`Balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);
  console.log(`Total Supply: ${ethers.formatUnits(totalSupply, decimals)} ${symbol}`);
  
  if (totalSupply > 0n) {
    const percentage = (Number(balance) / Number(totalSupply) * 100).toFixed(4);
    console.log(`Percentage of Total Supply: ${percentage}%`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
