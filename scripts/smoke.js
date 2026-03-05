const hre = require("hardhat");

const TELEPORTER_ENV_BY_NETWORK = {
  cchain_testnet: "TELEPORTER_MESSENGER_CCHAIN",
  dfk_testnet: "TELEPORTER_MESSENGER_DFK",
  beam_testnet: "TELEPORTER_MESSENGER_BEAM",
};

function getTeleporterAddressForNetwork(networkName) {
  const envKey = TELEPORTER_ENV_BY_NETWORK[networkName];
  if (!envKey) {
    return { envKey: "n/a", address: "" };
  }

  return {
    envKey,
    address: process.env[envKey]?.trim() || "",
  };
}

async function main() {
  const provider = hre.ethers.provider;
  const rpcUrl = typeof hre.network.config.url === "string" ? hre.network.config.url : "n/a";
  const privateKey = process.env.PRIVATE_KEY?.trim();
  const teleporter = getTeleporterAddressForNetwork(hre.network.name);

  console.log("Smoke check OK");
  console.log(`network: ${hre.network.name}`);
  console.log(`rpcUrl: ${rpcUrl}`);
  console.log(`teleporterEnvVar: ${teleporter.envKey}`);
  console.log(`teleporterAddress: ${teleporter.address || "n/a"}`);
  if (privateKey && /^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    const senderAddress = new hre.ethers.Wallet(privateKey).address;
    console.log(`senderAddressFromPrivateKey: ${senderAddress}`);
  } else {
    console.log("senderAddressFromPrivateKey: n/a (PRIVATE_KEY missing or invalid)");
  }

  try {
    const [networkInfo, blockNumber, feeData] = await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber(),
      provider.getFeeData(),
    ]);
    const latestBlock = await provider.getBlock(blockNumber);

    console.log("rpcReachable: true");
    console.log(`chainId: ${networkInfo.chainId.toString()}`);
    console.log(`latestBlock: ${blockNumber}`);
    console.log(`latestTimestamp: ${latestBlock?.timestamp ?? "n/a"}`);
    console.log(`gasPrice: ${feeData.gasPrice?.toString() ?? "n/a"}`);

    const signers = await hre.ethers.getSigners();
    if (signers.length > 0) {
      console.log(`hardhatSignerAddress: ${await signers[0].getAddress()}`);
    }

    if (!hre.ethers.isAddress(teleporter.address)) {
      console.log("🔴 WARP_MESSENGER not found: invalid teleporter address in env");
      return;
    }

    const teleporterContract = new hre.ethers.Contract(
      teleporter.address,
      ["function WARP_MESSENGER() view returns (address)"],
      provider
    );

    try {
      const warpMessenger = await teleporterContract.WARP_MESSENGER();
      if (hre.ethers.isAddress(warpMessenger) && warpMessenger !== hre.ethers.ZeroAddress) {
        console.log(`🟢 WARP_MESSENGER found: ${warpMessenger}`);
      } else {
        console.log(`🔴 WARP_MESSENGER returned empty/zero address: ${warpMessenger}`);
      }
    } catch (warpError) {
      const message = warpError instanceof Error ? warpError.message : String(warpError);
      console.log(`🔴 WARP_MESSENGER not found: ${message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("rpcReachable: false");
    console.log(`rpcError: ${message}`);
    console.log("🔴 WARP_MESSENGER not found: RPC not reachable");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
