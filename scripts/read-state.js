const hre = require("hardhat");
const {
  NETWORK_KEYS,
  ensureNetworkKey,
  getRuntimeConfig,
  parseArgs,
  readDeployments,
} = require("./lib/config");

async function main() {
  const { ethers } = hre;
  const args = parseArgs();
  const runtime = getRuntimeConfig();
  const deployments = readDeployments(args.deployments);

  const selectedNetworks = args.network
    ? [ensureNetworkKey(args.network, "network")]
    : NETWORK_KEYS;

  const receiverArtifact = await hre.artifacts.readArtifact("PingReceiver");

  for (const key of selectedNetworks) {
    const deployed = deployments.networks[key];
    if (!deployed) {
      throw new Error(`deployments.json missing network: ${key}`);
    }

    const provider = new ethers.JsonRpcProvider(runtime.networks[key].rpcUrl);
    const receiver = new ethers.Contract(
      deployed.receiver,
      receiverArtifact.abi,
      provider
    );

    const [
      totalReceived,
      lastPayloadHash,
      lastOriginChainId,
      lastOriginSender,
      cchainCount,
      dfkCount,
      beamCount,
    ] = await Promise.all([
      receiver.totalReceived(),
      receiver.lastPayloadHash(),
      receiver.lastOriginChainId(),
      receiver.lastOriginSender(),
      receiver.receivedBySourceChain(deployments.networks.cchain.chainId),
      receiver.receivedBySourceChain(deployments.networks.dfk.chainId),
      receiver.receivedBySourceChain(deployments.networks.beam.chainId),
    ]);

    console.log(`\n[${key}]`);
    console.log(`  chainId: ${deployed.chainId}`);
    console.log(`  messenger: ${deployed.messenger}`);
    console.log(`  receiver: ${deployed.receiver}`);
    console.log(`  sender: ${deployed.sender}`);
    console.log(`  totalReceived: ${totalReceived}`);
    console.log(`  lastPayloadHash: ${lastPayloadHash}`);
    console.log(`  lastOriginChainId: ${lastOriginChainId}`);
    console.log(`  lastOriginSender: ${lastOriginSender}`);
    console.log(`  receivedBySourceChain[cchain]: ${cchainCount}`);
    console.log(`  receivedBySourceChain[dfk]: ${dfkCount}`);
    console.log(`  receivedBySourceChain[beam]: ${beamCount}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
