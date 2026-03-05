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

  const policyServerAddress = requireAddress(
    process.env.POLICY_SERVER_ADDRESS,
    "POLICY_SERVER_ADDRESS"
  );

  const allowedClientChainId = requireUint(
    process.env.POLICY_ALLOWED_CLIENT_CHAIN_ID,
    "POLICY_ALLOWED_CLIENT_CHAIN_ID"
  );

  const allowedClientSender = requireAddress(
    process.env.POLICY_ALLOWED_CLIENT_SENDER,
    "POLICY_ALLOWED_CLIENT_SENDER"
  );

  const allow = String(process.env.POLICY_ALLOW || "true").toLowerCase() !== "false";

  const [admin] = await ethers.getSigners();
  if (!admin) {
    throw new Error("No signer available. Check PRIVATE_KEY in .env");
  }

  const server = await ethers.getContractAt("PolicyServer", policyServerAddress, admin);

  const tx = await server.setAllowedRequestSource(
    allowedClientChainId,
    allowedClientSender,
    allow
  );
  await tx.wait();

  console.log(`PolicyServer: ${policyServerAddress}`);
  console.log(
    `allowed request source set: chain=${allowedClientChainId} sender=${allowedClientSender} allow=${allow}`
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
