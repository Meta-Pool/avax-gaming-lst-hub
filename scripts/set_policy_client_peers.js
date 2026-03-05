const hre = require("hardhat");

function requireAddress(value, field) {
  const { ethers } = hre;
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`Invalid or missing address for ${field}`);
  }
  return value;
}

function requireUint(value, field) {
  if (!value || Number.isNaN(Number(value))) {
    throw new Error(`Invalid or missing numeric value for ${field}`);
  }
  return BigInt(value);
}

async function main() {
  const { ethers } = hre;

  const policyClientAddress = requireAddress(
    process.env.POLICY_CLIENT_ADDRESS,
    "POLICY_CLIENT_ADDRESS"
  );

  const allowedSourceChainId = requireUint(
    process.env.POLICY_ALLOWED_SOURCE_CHAIN_ID,
    "POLICY_ALLOWED_SOURCE_CHAIN_ID"
  );

  const allowedSourceSender = requireAddress(
    process.env.POLICY_ALLOWED_SOURCE_SENDER,
    "POLICY_ALLOWED_SOURCE_SENDER"
  );

  const requestTargetChainId = requireUint(
    process.env.POLICY_REQUEST_TARGET_CHAIN_ID,
    "POLICY_REQUEST_TARGET_CHAIN_ID"
  );

  const requestTargetSender = requireAddress(
    process.env.POLICY_REQUEST_TARGET_SENDER,
    "POLICY_REQUEST_TARGET_SENDER"
  );

  const allow = String(process.env.POLICY_ALLOW || "true").toLowerCase() !== "false";

  const [admin] = await ethers.getSigners();
  if (!admin) {
    throw new Error("No signer available. Check PRIVATE_KEY in .env");
  }

  const client = await ethers.getContractAt("PolicyClient", policyClientAddress, admin);

  const tx1 = await client.setAllowedPolicySource(
    allowedSourceChainId,
    allowedSourceSender,
    allow
  );
  await tx1.wait();

  const tx2 = await client.setRequestTarget(
    requestTargetChainId,
    requestTargetSender
  );
  await tx2.wait();

  console.log(`PolicyClient: ${policyClientAddress}`);
  console.log(
    `allowed source set: chain=${allowedSourceChainId} sender=${allowedSourceSender} allow=${allow}`
  );
  console.log(
    `request target set: chain=${requestTargetChainId} sender=${requestTargetSender}`
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
