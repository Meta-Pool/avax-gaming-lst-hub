const hre = require("hardhat");
const {
  NETWORK_KEYS,
  getRuntimeConfig,
  parseArgs,
  writeDeployments,
} = require("./lib/config");

async function deployForNetwork({
  networkKey,
  networkConfig,
  privateKey,
  receiverArtifact,
  senderArtifact,
}) {
  const { ethers } = hre;

  if (!ethers.isAddress(networkConfig.messenger)) {
    throw new Error(
      `[${networkKey}] invalid messenger address: ${networkConfig.messenger}`
    );
  }

  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const chainId = Number((await provider.getNetwork()).chainId);

  console.log(`[${networkKey}] chainId=${chainId} deployer=${wallet.address}`);

  const receiverFactory = new ethers.ContractFactory(
    receiverArtifact.abi,
    receiverArtifact.bytecode,
    wallet
  );
  const receiver = await receiverFactory.deploy(networkConfig.messenger);
  await receiver.waitForDeployment();
  const receiverAddress = await receiver.getAddress();

  const senderFactory = new ethers.ContractFactory(
    senderArtifact.abi,
    senderArtifact.bytecode,
    wallet
  );
  const sender = await senderFactory.deploy(networkConfig.messenger);
  await sender.waitForDeployment();
  const senderAddress = await sender.getAddress();

  console.log(
    `[${networkKey}] receiver=${receiverAddress} sender=${senderAddress} messenger=${networkConfig.messenger}`
  );

  return {
    chainId,
    rpcUrl: networkConfig.rpcUrl,
    messenger: networkConfig.messenger,
    receiver: receiverAddress,
    sender: senderAddress,
  };
}

async function main() {
  const args = parseArgs();
  const runtime = getRuntimeConfig();

  const receiverArtifact = await hre.artifacts.readArtifact("PingReceiver");
  const senderArtifact = await hre.artifacts.readArtifact("PingSender");

  const deployments = {
    updatedAt: new Date().toISOString(),
    networks: {},
  };

  for (const networkKey of NETWORK_KEYS) {
    const data = await deployForNetwork({
      networkKey,
      networkConfig: runtime.networks[networkKey],
      privateKey: runtime.privateKey,
      receiverArtifact,
      senderArtifact,
    });
    deployments.networks[networkKey] = data;
  }

  const outputPath = writeDeployments(deployments, args.out);
  console.log(`Deployments written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
