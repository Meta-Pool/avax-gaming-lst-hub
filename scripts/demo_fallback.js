const hre = require("hardhat");

function parseWeights(raw) {
  const weights = (raw || "4000,3000,2000,1000")
    .split(",")
    .map((x) => Number(x.trim()));

  if (weights.length !== 4) {
    throw new Error("DEMO_FALLBACK_WEIGHTS_BPS must contain 4 values");
  }

  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum !== 10000) {
    throw new Error(`DEMO_FALLBACK_WEIGHTS_BPS sum must be 10000, got ${sum}`);
  }

  return weights;
}

function mapBuckets(ids, amounts) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 1) {
    out.set(ids[i].toString(), amounts[i]);
  }
  return out;
}

async function main() {
  const { ethers, network } = hre;
  if (network.name !== "hardhat") {
    throw new Error(`Run this demo on hardhat network. Current: ${network.name}`);
  }

  const [owner] = await ethers.getSigners();
  const sourceChainId = BigInt(process.env.DEMO_FALLBACK_SOURCE_CHAIN_ID || "43113");
  const targetChainId = BigInt(process.env.DEMO_FALLBACK_TARGET_CHAIN_ID || "4337");

  const knownEpoch = BigInt(process.env.DEMO_FALLBACK_KNOWN_EPOCH || "1");
  const weights = parseWeights(process.env.DEMO_FALLBACK_WEIGHTS_BPS);
  const validatorIds = [1n, 2n, 3n, 4n];

  const policyEpochSeconds = BigInt(process.env.DEMO_FALLBACK_EPOCH_SECONDS || "60");
  const depositAmount = ethers.parseUnits(
    process.env.DEMO_FALLBACK_DEPOSIT || "100",
    18
  );
  const depositFeeBps = Number(process.env.DEPOSIT_FEE_BPS || "100");

  const messengerFactory = await ethers.getContractFactory("MockTeleporterMessenger");
  const messenger = await messengerFactory.deploy(owner.address);
  await messenger.waitForDeployment();

  const policyClientFactory = await ethers.getContractFactory("PolicyClient");
  const policyClient = await policyClientFactory.deploy(
    await messenger.getAddress(),
    owner.address
  );
  await policyClient.waitForDeployment();

  const sourceSender = ethers.Wallet.createRandom().address;
  const requestTargetSender = ethers.Wallet.createRandom().address;

  await (await policyClient.setAllowedPolicySource(sourceChainId, sourceSender, true)).wait();
  await (await policyClient.setRequestTarget(sourceChainId, requestTargetSender)).wait();

  const abi = ethers.AbiCoder.defaultAbiCoder();
  const policyResponsePayload = abi.encode(
    ["uint8", "uint256", "uint256[]", "uint16[]"],
    [2, knownEpoch, validatorIds, weights]
  );

  await (
    await messenger.relayMessage(
      await policyClient.getAddress(),
      sourceChainId,
      sourceSender,
      policyResponsePayload
    )
  ).wait();

  if (!(await policyClient.hasPolicyForEpoch(knownEpoch))) {
    throw new Error("Failed to seed known policy in PolicyClient");
  }

  const beamAssetFactory = await ethers.getContractFactory("BeamAssetMock");
  const beamAsset = await beamAssetFactory.deploy(
    "Wrapped BEAM Mock",
    "WBEAM",
    owner.address,
    ethers.parseUnits("1000000", 18)
  );
  await beamAsset.waitForDeployment();

  const blockTs = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const startTs = blockTs - (policyEpochSeconds * 2n);

  const vaultFactory = await ethers.getContractFactory("StBEAMVault");
  const vault = await vaultFactory.deploy(
    await beamAsset.getAddress(),
    depositFeeBps,
    owner.address,
    await policyClient.getAddress(),
    policyEpochSeconds,
    startTs
  );
  await vault.waitForDeployment();

  const epochToUse = await vault.getApplicablePolicyEpoch();

  // Simulate request without response for the new epoch.
  await (
    await policyClient["requestPolicy(uint256,address)"](
      epochToUse,
      await vault.getAddress()
    )
  ).wait();

  const bucketsBeforeResult = await vault.getBuckets();
  const bucketIdsBefore = bucketsBeforeResult[0] || bucketsBeforeResult.validatorIds;
  const bucketAmountsBefore = bucketsBeforeResult[1] || bucketsBeforeResult.amounts;
  const before = mapBuckets(bucketIdsBefore, bucketAmountsBefore);

  await (await beamAsset.approve(await vault.getAddress(), depositAmount)).wait();
  const depositTx = await vault.deposit(depositAmount, owner.address);
  const receipt = await depositTx.wait();

  let sawFallback = false;
  let sawPolicyApplied = false;
  let sawBucketsUpdated = false;

  for (const log of receipt.logs) {
    try {
      if (log.address.toLowerCase() === (await policyClient.getAddress()).toLowerCase()) {
        const parsed = policyClient.interface.parseLog(log);
        if (parsed.name === "PolicyFallbackUsed") {
          sawFallback = true;
        }
      }

      if (log.address.toLowerCase() === (await vault.getAddress()).toLowerCase()) {
        const parsed = vault.interface.parseLog(log);
        if (parsed.name === "PolicyApplied") {
          sawPolicyApplied = true;
        }
        if (parsed.name === "BucketsUpdated") {
          sawBucketsUpdated = true;
        }
      }
    } catch (_) {
      // ignore unrelated logs
    }
  }

  const bucketsAfterResult = await vault.getBuckets();
  const bucketIdsAfter = bucketsAfterResult[0] || bucketsAfterResult.validatorIds;
  const bucketAmountsAfter = bucketsAfterResult[1] || bucketsAfterResult.amounts;
  const after = mapBuckets(bucketIdsAfter, bucketAmountsAfter);

  let delta = 0n;
  for (const [id, afterAmount] of after.entries()) {
    const beforeAmount = before.get(id) || 0n;
    delta += afterAmount - beforeAmount;
  }

  const expectedFee = (depositAmount * BigInt(depositFeeBps)) / 10000n;
  const expectedNet = depositAmount - expectedFee;

  if (!sawFallback) {
    throw new Error("Fallback event was not observed (PolicyFallbackUsed)");
  }
  if (!sawPolicyApplied || !sawBucketsUpdated) {
    throw new Error("PolicyApplied/BucketsUpdated not observed on deposit");
  }
  if (delta !== expectedNet) {
    throw new Error(`Bucket delta mismatch: expected ${expectedNet}, got ${delta}`);
  }

  const policyResult = await policyClient.getPolicyOrFallback(epochToUse);
  const policyEpochUsed = policyResult[0] || policyResult.policyEpoch;
  const policyIds = policyResult[1] || policyResult.validatorIds;
  const policyWeights = policyResult[2] || policyResult.weightBps;
  const usedFallback = policyResult[3] || policyResult.usedFallback;

  console.log("=== FALLBACK DEMO ===");
  console.log(`epoch solicitado: ${epochToUse}`);
  console.log(`policy epoch usada (fallback): ${policyEpochUsed}`);
  console.log(`usedFallback: ${usedFallback}`);
  console.log(
    "policy final usada:",
    policyIds.map((id, i) => ({
      validatorId: id.toString(),
      weightBps: Number(policyWeights[i]),
    }))
  );
  console.log(
    "buckets resultantes:",
    bucketIdsAfter.map((id, i) => ({
      validatorId: id.toString(),
      amount: bucketAmountsAfter[i].toString(),
    }))
  );
  console.log(`expected net: ${expectedNet}`);
  console.log(`bucket delta: ${delta}`);
  console.log("SUCCESS");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
