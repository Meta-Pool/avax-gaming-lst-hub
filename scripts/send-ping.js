const hre = require("hardhat");
const {
  ensureNetworkKey,
  getRuntimeConfig,
  parseArgs,
  readDeployments,
  sleep,
} = require("./lib/config");

function toBytesPayload(payload, ethers) {
  if (typeof payload !== "string" || payload.length === 0) {
    return ethers.toUtf8Bytes(`ping:${new Date().toISOString()}`);
  }

  if (payload.startsWith("0x")) {
    return payload;
  }

  return ethers.toUtf8Bytes(payload);
}

function parsePingSent(receipt, senderInterface) {
  for (const log of receipt.logs) {
    try {
      const parsed = senderInterface.parseLog(log);
      if (parsed && parsed.name === "PingSent") {
        return parsed;
      }
    } catch (_) {
      // ignore non-matching logs
    }
  }
  return null;
}

async function main() {
  const { ethers } = hre;
  const args = parseArgs();
  const runtime = getRuntimeConfig();
  const deployments = readDeployments(args.deployments);

  const from = ensureNetworkKey(args.from || "dfk", "from");
  const to = ensureNetworkKey(args.to || "cchain", "to");

  if (from === to) {
    throw new Error("from and to must be different networks");
  }

  const source = deployments.networks[from];
  const destination = deployments.networks[to];
  if (!source || !destination) {
    throw new Error("deployments.json is missing source or destination networks");
  }

  const sourceProvider = new ethers.JsonRpcProvider(runtime.networks[from].rpcUrl);
  const destinationProvider = new ethers.JsonRpcProvider(runtime.networks[to].rpcUrl);
  const wallet = new ethers.Wallet(runtime.privateKey, sourceProvider);

  const senderArtifact = await hre.artifacts.readArtifact("PingSender");
  const receiverArtifact = await hre.artifacts.readArtifact("PingReceiver");

  const sender = new ethers.Contract(source.sender, senderArtifact.abi, wallet);
  const receiver = new ethers.Contract(
    destination.receiver,
    receiverArtifact.abi,
    destinationProvider
  );

  const payload = toBytesPayload(args.payload, ethers);
  const beforeCount = await receiver.totalReceived();

  const tx = await sender.sendPing(destination.chainId, destination.receiver, payload);
  console.log(`sendPing tx hash: ${tx.hash}`);

  const receipt = await tx.wait();
  const parsed = parsePingSent(receipt, sender.interface);

  if (parsed) {
    console.log(`messageId: ${parsed.args.messageId}`);
    console.log(`payloadHash: ${parsed.args.payloadHash}`);
  } else {
    console.log("PingSent event not found in source tx logs");
  }

  const timeoutSeconds = Number(args.timeout || 120);
  const pollSeconds = Number(args.poll || 5);
  const strict = Boolean(args.strict);

  let relayed = false;
  for (let elapsed = 0; elapsed < timeoutSeconds; elapsed += pollSeconds) {
    const current = await receiver.totalReceived();
    if (current > beforeCount) {
      relayed = true;
      break;
    }
    await sleep(pollSeconds * 1000);
  }

  if (!relayed) {
    const message =
      "No destination update observed before timeout. Check relayer/ICM stack.";
    if (strict) {
      throw new Error(message);
    }
    console.log(message);
    return;
  }

  const [totalReceived, lastPayloadHash, lastOriginChainId, lastOriginSender] =
    await Promise.all([
      receiver.totalReceived(),
      receiver.lastPayloadHash(),
      receiver.lastOriginChainId(),
      receiver.lastOriginSender(),
    ]);

  console.log(`Destination receiver updated:`);
  console.log(`  totalReceived: ${totalReceived}`);
  console.log(`  lastPayloadHash: ${lastPayloadHash}`);
  console.log(`  lastOriginChainId: ${lastOriginChainId}`);
  console.log(`  lastOriginSender: ${lastOriginSender}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
