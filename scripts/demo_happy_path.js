const hre = require("hardhat");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseWeights(raw) {
  const parts = (raw || "4000,3000,2000,1000")
    .split(",")
    .map((p) => Number(p.trim()));

  if (parts.length !== 4) {
    throw new Error("DEMO_POLICY_WEIGHTS_BPS must contain 4 comma-separated values");
  }

  const sum = parts.reduce((acc, v) => acc + v, 0);
  if (sum !== 10000) {
    throw new Error(`DEMO_POLICY_WEIGHTS_BPS sum must be 10000, got ${sum}`);
  }

  return parts;
}

async function getFactory(name, signer) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new hre.ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
}

function parseCrossChainMessages(receipt, messenger) {
  const out = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== (messenger.target || messenger.address).toLowerCase()) {
      continue;
    }

    try {
      const parsed = messenger.interface.parseLog(log);
      if (parsed && parsed.name === "CrossChainMessageSent") {
        out.push(parsed.args);
      }
    } catch (_) {
      // ignore non-matching logs
    }
  }
  return out;
}

function toBucketMap(ids, amounts) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += 1) {
    map.set(ids[i].toString(), amounts[i]);
  }
  return map;
}

async function main() {
  const { ethers } = hre;

  const rpcC = requireEnv("RPC_CCHAIN_TESTNET");
  const rpcB = requireEnv("RPC_BEAM_TESTNET");
  const privateKey = requireEnv("PRIVATE_KEY");

  const cProvider = new ethers.JsonRpcProvider(rpcC);
  const bProvider = new ethers.JsonRpcProvider(rpcB);
  const cWallet = new ethers.Wallet(privateKey, cProvider);
  const bWallet = new ethers.Wallet(privateKey, bProvider);

  const cChainId = Number((await cProvider.getNetwork()).chainId);
  const bChainId = Number((await bProvider.getNetwork()).chainId);

  const policyWeights = parseWeights(process.env.DEMO_POLICY_WEIGHTS_BPS);
  const vpLockDays = Number(process.env.DEMO_VP_LOCK_DAYS || "60");
  const vpStakeAmount = ethers.parseUnits(process.env.DEMO_VP_STAKE_AMOUNT || "1000", 6);
  const beamDepositAmount = ethers.parseUnits(process.env.DEMO_BEAM_DEPOSIT || "100", 18);
  const policyEpochSeconds = Number(process.env.DEMO_POLICY_EPOCH_SECONDS || "3600");
  const depositFeeBps = Number(process.env.DEPOSIT_FEE_BPS || "100");

  console.log("=== Deploying mock messengers ===");
  const messengerFactoryC = await getFactory("MockTeleporterMessenger", cWallet);
  const messengerFactoryB = await getFactory("MockTeleporterMessenger", bWallet);
  const messengerC = await messengerFactoryC.deploy(cWallet.address);
  const messengerB = await messengerFactoryB.deploy(bWallet.address);
  await messengerC.waitForDeployment();
  await messengerB.waitForDeployment();

  console.log("=== C-Chain setup: mpDAO + VotingPower + PolicyGovernor + PolicyServer ===");
  const mpdaoFactory = await getFactory("MpDaoToken", cWallet);
  const mpdao = await mpdaoFactory.deploy("Meta Pool DAO", "mpDAO", cWallet.address, 0);
  await mpdao.waitForDeployment();

  const vpImplFactory = await getFactory("VotingPowerV1", cWallet);
  const vpImpl = await vpImplFactory.deploy();
  await vpImpl.waitForDeployment();

  const proxyFactory = await getFactory("ERC1967Proxy", cWallet);
  const initData = vpImpl.interface.encodeFunctionData("initialize", [await mpdao.getAddress()]);
  const vpProxy = await proxyFactory.deploy(await vpImpl.getAddress(), initData);
  await vpProxy.waitForDeployment();
  const votingPower = new ethers.Contract(await vpProxy.getAddress(), vpImpl.interface.fragments, cWallet);

  await (await mpdao.mint(cWallet.address, vpStakeAmount)).wait();
  await (await mpdao.approve(await votingPower.getAddress(), vpStakeAmount)).wait();
  await (await votingPower.createLockedPosition(vpLockDays, vpStakeAmount)).wait();

  const vpA = await votingPower.getVotingPower(cWallet.address);
  const vpB = await votingPower.getVotingPower(ethers.Wallet.createRandom().address);
  if (vpA <= 0n || vpB !== 0n) {
    throw new Error("VP precondition failed (user A should have VP > 0, user B should be 0)");
  }

  const governorFactory = await getFactory("PolicyGovernor", cWallet);
  const governor = await governorFactory.deploy(
    await votingPower.getAddress(),
    policyEpochSeconds,
    false,
    1,
    []
  );
  await governor.waitForDeployment();

  await (await governor.vote(policyWeights)).wait();
  await (await governor.finalizeCurrentEpoch()).wait();
  const finalizedEpoch = await governor.getLatestFinalizedEpoch();
  const policy = await governor.getPolicy(finalizedEpoch);

  const serverFactory = await getFactory("PolicyServer", cWallet);
  const policyServer = await serverFactory.deploy(
    await messengerC.getAddress(),
    await governor.getAddress(),
    cWallet.address
  );
  await policyServer.waitForDeployment();

  console.log("=== BEAM setup: PolicyClient + stBEAM vault ===");
  const clientFactory = await getFactory("PolicyClient", bWallet);
  const policyClient = await clientFactory.deploy(await messengerB.getAddress(), bWallet.address);
  await policyClient.waitForDeployment();

  const beamAssetFactory = await getFactory("BeamAssetMock", bWallet);
  const beamAsset = await beamAssetFactory.deploy(
    "Wrapped BEAM Mock",
    "WBEAM",
    bWallet.address,
    ethers.parseUnits("1000000", 18)
  );
  await beamAsset.waitForDeployment();

  const latestBeamTs = (await bProvider.getBlock("latest")).timestamp;
  const policyStartTs = BigInt(latestBeamTs - policyEpochSeconds * Number(finalizedEpoch));

  const vaultFactory = await getFactory("StBEAMVault", bWallet);
  const vault = await vaultFactory.deploy(
    await beamAsset.getAddress(),
    depositFeeBps,
    bWallet.address,
    await policyClient.getAddress(),
    policyEpochSeconds,
    policyStartTs
  );
  await vault.waitForDeployment();

  await (await policyServer.setAllowedRequestSource(
    bChainId,
    await policyClient.getAddress(),
    true
  )).wait();

  await (await policyClient.setAllowedPolicySource(
    cChainId,
    await policyServer.getAddress(),
    true
  )).wait();

  await (await policyClient.setRequestTarget(cChainId, await policyServer.getAddress())).wait();

  const epochToUse = await vault.getApplicablePolicyEpoch();

  console.log("=== Cross-chain request/response (simulated relay) ===");
  const reqTx = await policyClient.requestPolicy(epochToUse, await vault.getAddress());
  const reqRcpt = await reqTx.wait();

  const outboundFromBeam = parseCrossChainMessages(reqRcpt, messengerB);
  if (outboundFromBeam.length === 0) {
    throw new Error("No outbound request message found on BEAM messenger");
  }
  const requestMessage = outboundFromBeam[outboundFromBeam.length - 1];

  const relayToServerTx = await messengerC.relayMessage(
    await policyServer.getAddress(),
    bChainId,
    await policyClient.getAddress(),
    requestMessage.message
  );
  const relayToServerRcpt = await relayToServerTx.wait();

  const outboundFromC = parseCrossChainMessages(relayToServerRcpt, messengerC);
  if (outboundFromC.length === 0) {
    throw new Error("No outbound response message found on C-Chain messenger");
  }
  const responseMessage = outboundFromC[outboundFromC.length - 1];

  await (await messengerB.relayMessage(
    await policyClient.getAddress(),
    cChainId,
    await policyServer.getAddress(),
    responseMessage.message
  )).wait();

  if (!(await policyClient.hasPolicyForEpoch(epochToUse))) {
    throw new Error("Policy response not stored on BEAM client");
  }

  console.log("=== BEAM deposit + policy application ===");
  const [bucketIdsBefore, bucketAmountsBefore] = await vault.getBuckets();
  const beforeMap = toBucketMap(bucketIdsBefore, bucketAmountsBefore);

  await (await beamAsset.approve(await vault.getAddress(), beamDepositAmount)).wait();
  const depTx = await vault.deposit(beamDepositAmount, bWallet.address);
  const depRcpt = await depTx.wait();

  let sawPolicyApplied = false;
  let sawBucketsUpdated = false;
  for (const log of depRcpt.logs) {
    if (log.address.toLowerCase() !== (await vault.getAddress()).toLowerCase()) {
      continue;
    }
    try {
      const parsed = vault.interface.parseLog(log);
      if (parsed.name === "PolicyApplied") sawPolicyApplied = true;
      if (parsed.name === "BucketsUpdated") sawBucketsUpdated = true;
    } catch (_) {
      // ignore
    }
  }

  if (!sawPolicyApplied || !sawBucketsUpdated) {
    throw new Error("Missing PolicyApplied/BucketsUpdated events on deposit");
  }

  const [bucketIdsAfter, bucketAmountsAfter] = await vault.getBuckets();
  const afterMap = toBucketMap(bucketIdsAfter, bucketAmountsAfter);
  let deltaSum = 0n;
  for (const [id, afterAmount] of afterMap.entries()) {
    const before = beforeMap.get(id) || 0n;
    deltaSum += afterAmount - before;
  }

  const expectedFee = (beamDepositAmount * BigInt(depositFeeBps)) / 10000n;
  const expectedNet = beamDepositAmount - expectedFee;

  if (deltaSum !== expectedNet) {
    throw new Error(`Bucket delta mismatch: expected ${expectedNet}, got ${deltaSum}`);
  }

  console.log("\n=== DEMO OUTPUT ===");
  console.log(`epoch usado: ${epochToUse.toString()}`);
  console.log(
    "policy final:",
    policy.map((p) => ({ validatorId: p.validatorId.toString(), weightBps: Number(p.weightBps) }))
  );
  console.log(
    "buckets resultantes:",
    bucketIdsAfter.map((id, i) => ({
      validatorId: id.toString(),
      amount: bucketAmountsAfter[i].toString(),
    }))
  );

  console.log("SUCCESS");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
