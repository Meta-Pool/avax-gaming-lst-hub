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
    return { updatedAt: new Date().toISOString(), networks: {} };
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const { ethers, network } = hre;

  if (network.name !== "cchain_testnet") {
    throw new Error(
      `This script is intended for cchain_testnet. Current network: ${network.name}`
    );
  }

  const tokenName = process.env.MPDAO_NAME || "Meta Pool DAO";
  const tokenSymbol = process.env.MPDAO_SYMBOL || "mpDAO";
  const initialSupplyWhole = process.env.MPDAO_INITIAL_SUPPLY || "0";

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account available. Check PRIVATE_KEY in .env");
  }

  const initialSupply = ethers.parseUnits(initialSupplyWhole, 6);
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const factory = await ethers.getContractFactory("MpDaoToken");
  const token = await factory.deploy(
    tokenName,
    tokenSymbol,
    deployer.address,
    initialSupply
  );
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  console.log(`MpDaoToken deployed at: ${tokenAddress}`);
  console.log(`deployer/owner: ${deployer.address}`);
  console.log(`chainId: ${chainId}`);

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);

  if (!deployments.networks[network.name]) {
    deployments.networks[network.name] = {};
  }

  deployments.networks[network.name].chainId = chainId.toString();
  deployments.networks[network.name].contracts = {
    ...(deployments.networks[network.name].contracts || {}),
    mpdao: {
      address: tokenAddress,
      name: tokenName,
      symbol: tokenSymbol,
      decimals: 6,
      owner: deployer.address,
    },
  };
  deployments.updatedAt = new Date().toISOString();

  fs.writeFileSync(deploymentsPath, `${JSON.stringify(deployments, null, 2)}\n`);
  console.log(`deployments saved to: ${deploymentsPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
