const hre = require("hardhat");

function expectedCurrentEpoch(startTimestamp, epochSeconds, ts) {
  if (ts < startTimestamp) {
    return 0n;
  }
  return BigInt(Math.floor((ts - startTimestamp) / epochSeconds) + 1);
}

function expectedApplicableEpoch(currentEpoch) {
  if (currentEpoch === 0n) {
    return 0n;
  }
  return currentEpoch - 1n;
}

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

async function main() {
  const { ethers, network } = hre;

  if (network.name !== "hardhat") {
    throw new Error(
      `Use --network hardhat for this verification script. Current: ${network.name}`
    );
  }

  const vpFactory = await ethers.getContractFactory("MockVotingPowerReader");
  const vp = await vpFactory.deploy();
  await vp.waitForDeployment();

  const governorFactory = await ethers.getContractFactory("PolicyGovernor");
  const governor = await governorFactory.deploy(
    await vp.getAddress(),
    60,
    false,
    1,
    []
  );
  await governor.waitForDeployment();

  const startTs = Number(await governor.START_TIMESTAMP());
  const epochSeconds = Number(await governor.EPOCH_SECONDS());

  const checks = [
    { offset: 0, expectedCurrent: 1n, expectedApplicable: 0n },
    { offset: 59, expectedCurrent: 1n, expectedApplicable: 0n },
    { offset: 60, expectedCurrent: 2n, expectedApplicable: 1n },
    { offset: 119, expectedCurrent: 2n, expectedApplicable: 1n },
    { offset: 120, expectedCurrent: 3n, expectedApplicable: 2n },
  ];

  for (const check of checks) {
    const ts = startTs + check.offset;
    const onchainCurrent = await governor.currentEpoch(ts);
    const onchainApplicable = await governor.applicableEpoch(ts);

    const expectedCurrent = expectedCurrentEpoch(startTs, epochSeconds, ts);
    const expectedApplicable = expectedApplicableEpoch(expectedCurrent);

    assertEq(onchainCurrent, check.expectedCurrent, `currentEpoch@+${check.offset}`);
    assertEq(
      onchainApplicable,
      check.expectedApplicable,
      `applicableEpoch@+${check.offset}`
    );

    assertEq(onchainCurrent, expectedCurrent, `formula currentEpoch@+${check.offset}`);
    assertEq(
      onchainApplicable,
      expectedApplicable,
      `formula applicableEpoch@+${check.offset}`
    );
  }

  const nowCurrent = await governor.getCurrentEpoch();
  const nowApplicable = await governor.getApplicableEpoch();
  assertEq(nowCurrent, 1n, "getCurrentEpoch at deploy");
  assertEq(nowApplicable, 0n, "getApplicableEpoch at deploy");

  await ethers.provider.send("evm_increaseTime", [61]);
  await ethers.provider.send("evm_mine", []);

  const advancedCurrent = await governor.getCurrentEpoch();
  const advancedApplicable = await governor.getApplicableEpoch();
  assertEq(advancedCurrent, 2n, "getCurrentEpoch after +61s");
  assertEq(advancedApplicable, 1n, "getApplicableEpoch after +61s");

  console.log("Policy timing verification passed");
  console.log(`startTimestamp=${startTs}`);
  console.log(
    "Rule: epochToUse = currentEpoch - 1 (returns 0 during the first epoch)"
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
