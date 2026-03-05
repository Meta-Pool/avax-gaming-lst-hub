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
    throw new Error(
      `deployments file not found: ${filePath}. Run deploy:mpdao first.`
    );
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function getMpDaoAddress(deployments, networkName) {
  const { ethers } = hre;
  const addr = deployments?.networks?.[networkName]?.contracts?.mpdao?.address;
  if (!addr || !ethers.isAddress(addr)) {
    throw new Error(
      `mpdao address missing in deployments for network ${networkName}`
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

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account available. Check PRIVATE_KEY in .env");
  }

  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);
  const mpdaoAddress = getMpDaoAddress(deployments, network.name);

  const implFactory = await ethers.getContractFactory("VotingPowerV1");
  const implementation = await implFactory.deploy();
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();

  const initData = implFactory.interface.encodeFunctionData("initialize", [
    mpdaoAddress,
  ]);

  const proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await proxyFactory.deploy(implementationAddress, initData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();

  const vpProxy = await ethers.getContractAt("VotingPowerV1", proxyAddress);
  const boundMpDao = await vpProxy.mpDAO();

  if (boundMpDao.toLowerCase() !== mpdaoAddress.toLowerCase()) {
    throw new Error(
      `VotingPower initialize mismatch: expected ${mpdaoAddress}, got ${boundMpDao}`
    );
  }

  const chainId = (await ethers.provider.getNetwork()).chainId;

  if (!deployments.networks[network.name]) {
    deployments.networks[network.name] = {};
  }

  deployments.networks[network.name].chainId = chainId.toString();
  deployments.networks[network.name].contracts = {
    ...(deployments.networks[network.name].contracts || {}),
    votingPower: {
      implementation: implementationAddress,
      proxy: proxyAddress,
      mpdao: mpdaoAddress,
    },
  };
  deployments.updatedAt = new Date().toISOString();

  fs.writeFileSync(deploymentsPath, `${JSON.stringify(deployments, null, 2)}\n`);

  console.log(`VotingPower implementation: ${implementationAddress}`);
  console.log(`VotingPower proxy: ${proxyAddress}`);
  console.log(`VotingPower mpDAO: ${boundMpDao}`);
  console.log(`deployments saved to: ${deploymentsPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
