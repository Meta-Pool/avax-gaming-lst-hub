const hre = require("hardhat");
const {
  ensureNetworkKey,
  getRuntimeConfig,
  parseArgs,
  readDeployments,
  sleep,
} = require("./lib/config");

function parsePath(pathArg) {
  const value = pathArg || "dfk,cchain,beam";
  const parts = value
    .split(",")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length !== 3) {
    throw new Error("--path must contain exactly 3 networks, e.g. dfk,cchain,beam");
  }

  return parts.map((part, index) => ensureNetworkKey(part, `path[${index}]`));
}

function buildPayload(ethers, source, destination, step) {
  return ethers.toUtf8Bytes(
    `triangle:${step}:${source}->${destination}:${new Date().toISOString()}`
  );
}

async function sendHop({
  ethers,
  sourceKey,
  destinationKey,
  step,
  runtime,
  deployments,
  senderArtifact,
  receiverArtifact,
  timeoutSeconds,
  pollSeconds,
}) {
  const source = deployments.networks[sourceKey];
  const destination = deployments.networks[destinationKey];

  if (!source || !destination) {
    throw new Error(
      `deployments.json is missing ${sourceKey} or ${destinationKey} addresses`
    );
  }

  const sourceProvider = new ethers.JsonRpcProvider(runtime.networks[sourceKey].rpcUrl);
  const destinationProvider = new ethers.JsonRpcProvider(
    runtime.networks[destinationKey].rpcUrl
  );
  const wallet = new ethers.Wallet(runtime.privateKey, sourceProvider);

  const sender = new ethers.Contract(source.sender, senderArtifact.abi, wallet);
  const receiver = new ethers.Contract(
    destination.receiver,
    receiverArtifact.abi,
    destinationProvider
  );

  const before = await receiver.totalReceived();
  const payload = buildPayload(ethers, sourceKey, destinationKey, step);

  const tx = await sender.sendPing(destination.chainId, destination.receiver, payload);
  console.log(`[hop ${step}] ${sourceKey} -> ${destinationKey} tx=${tx.hash}`);
  await tx.wait();

  for (let elapsed = 0; elapsed < timeoutSeconds; elapsed += pollSeconds) {
    const current = await receiver.totalReceived();
    if (current > before) {
      const hash = await receiver.lastPayloadHash();
      console.log(`[hop ${step}] relayed. totalReceived=${current} lastPayloadHash=${hash}`);
      return true;
    }
    await sleep(pollSeconds * 1000);
  }

  console.log(
    `[hop ${step}] no destination update before timeout. Check relayer/ICM stack.`
  );
  return false;
}

async function main() {
  const { ethers } = hre;
  const args = parseArgs();
  const runtime = getRuntimeConfig();
  const deployments = readDeployments(args.deployments);

  const path = parsePath(args.path);
  const timeoutSeconds = Number(args.timeout || 120);
  const pollSeconds = Number(args.poll || 5);
  const strict = Boolean(args.strict);

  const senderArtifact = await hre.artifacts.readArtifact("PingSender");
  const receiverArtifact = await hre.artifacts.readArtifact("PingReceiver");

  const firstOk = await sendHop({
    ethers,
    sourceKey: path[0],
    destinationKey: path[1],
    step: 1,
    runtime,
    deployments,
    senderArtifact,
    receiverArtifact,
    timeoutSeconds,
    pollSeconds,
  });

  const secondOk = await sendHop({
    ethers,
    sourceKey: path[1],
    destinationKey: path[2],
    step: 2,
    runtime,
    deployments,
    senderArtifact,
    receiverArtifact,
    timeoutSeconds,
    pollSeconds,
  });

  if (strict && (!firstOk || !secondOk)) {
    throw new Error("Triangle flow did not complete in strict mode");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
