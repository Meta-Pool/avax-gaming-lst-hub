const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function getDeploymentsPath() {
  const custom = process.env.DEPLOYMENTS_FILE;
  return custom && custom.length > 0
    ? path.resolve(process.cwd(), custom)
    : path.resolve(process.cwd(), "deployments.json");
}

function readDeployments(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`deployments file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

async function verifyContract(address, constructorArguments, contractName = null) {
  console.log(`\nVerifying contract at ${address}...`);
  console.log(`Constructor args:`, constructorArguments);
  
  try {
    const verifyParams = {
      address: address,
      constructorArguments: constructorArguments,
    };
    
    if (contractName) {
      verifyParams.contract = contractName;
    }

    await hre.run("verify:verify", verifyParams);
    console.log(`✓ Successfully verified ${address}`);
    return true;
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      console.log(`✓ Already verified ${address}`);
      return true;
    }
    console.error(`✗ Failed to verify ${address}:`, error.message);
    return false;
  }
}

async function verifyMpDao(contractInfo, networkName) {
  const name = contractInfo.name || "Meta Pool DAO";
  const symbol = contractInfo.symbol || "mpDAO";
  const owner = contractInfo.owner;
  
  // Initial supply is 0 based on deployment script (parseUnits("0", 6))
  const initialSupply = "0";
  
  return await verifyContract(
    contractInfo.address,
    [name, symbol, owner, initialSupply],
    "contracts/MpDaoToken.sol:MpDaoToken"
  );
}

async function verifyVotingPower(contractInfo) {
  const { ethers } = hre;
  
  // Verify implementation (no constructor args)
  console.log("\n--- VotingPower Implementation ---");
  await verifyContract(
    contractInfo.implementation,
    [],
    "contracts/VotingPowerV1.sol:VotingPowerV1"
  );
  
  // Verify proxy
  console.log("\n--- VotingPower Proxy ---");
  const implFactory = await ethers.getContractFactory("VotingPowerV1");
  const initData = implFactory.interface.encodeFunctionData("initialize", [
    contractInfo.mpdao,
  ]);
  
  // ERC1967Proxy constructor: (address implementation, bytes memory _data)
  return await verifyContract(
    contractInfo.proxy,
    [contractInfo.implementation, initData],
    "contracts/vendor/openzeppelin/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
  );
}

async function verifyPolicyGovernor(contractInfo) {
  const validatorIds = contractInfo.validatorIds || [1, 2, 3, 4];
  
  // PolicyGovernor constructor: (votingPower, epochSeconds, useQuorumBps, quorumValue, validatorIds)
  // Note: startTimestamp is set to block.timestamp automatically, not a constructor parameter
  const args = [
    contractInfo.votingPower,
    contractInfo.epochSeconds,
    contractInfo.quorumMode === "BPS", // useQuorumBps
    contractInfo.quorumValue,
    validatorIds
  ];
  
  return await verifyContract(
    contractInfo.address,
    args,
    "contracts/PolicyGovernor.sol:PolicyGovernor"
  );
}

async function verifyPolicyServer(contractInfo) {
  return await verifyContract(
    contractInfo.address,
    [
      contractInfo.policyGovernor,
      contractInfo.teleporterMessenger,
      contractInfo.owner
    ],
    "contracts/PolicyServer.sol:PolicyServer"
  );
}

async function verifyPolicyClient(contractInfo) {
  return await verifyContract(
    contractInfo.address,
    [contractInfo.teleporterMessenger, contractInfo.owner],
    "contracts/PolicyClient.sol:PolicyClient"
  );
}

async function verifyBeamAsset(contractInfo) {
  return await verifyContract(
    contractInfo.address,
    [contractInfo.name, contractInfo.symbol],
    "contracts/BeamAssetMock.sol:BeamAssetMock"
  );
}

async function verifyMockPolicyClient(contractInfo) {
  // MockPolicyClient has no constructor arguments
  return await verifyContract(
    contractInfo.address,
    [],
    "contracts/mocks/MockPolicyClient.sol:MockPolicyClient"
  );
}

async function verifyStBeamVault(contractInfo, networkData) {
  // StBEAMVault constructor params:
  // asset, policyClient, policyEpochSeconds, policyStartTimestamp, 
  // depositFeeBps, owner, feeMode (0=deposited, 1=underlying)
  
  const owner = networkData.contracts.realPolicyClient?.owner || contractInfo.owner;
  const feeMode = contractInfo.feeMode === "on_deposited_amount" ? 0 : 1;
  
  return await verifyContract(
    contractInfo.address,
    [
      contractInfo.asset,
      contractInfo.policyClient,
      contractInfo.policyEpochSeconds,
      contractInfo.policyStartTimestamp,
      contractInfo.depositFeeBps,
      owner,
      feeMode
    ],
    "contracts/StBEAMVault.sol:StBEAMVault"
  );
}

async function main() {
  const { network } = hre;
  
  // Allow user to specify which network to verify
  const targetNetwork = process.env.VERIFY_NETWORK || network.name;
  
  // Allow user to specify which contract(s) to verify (comma-separated)
  // Examples: VERIFY_ONLY=mpdao or VERIFY_ONLY=mpdao,votingPower
  const verifyOnly = process.env.VERIFY_ONLY 
    ? process.env.VERIFY_ONLY.split(",").map(c => c.trim().toLowerCase())
    : null;
  
  const deploymentsPath = getDeploymentsPath();
  const deployments = readDeployments(deploymentsPath);
  
  const networkData = deployments.networks[targetNetwork];
  if (!networkData) {
    throw new Error(`Network ${targetNetwork} not found in deployments.json`);
  }
  
  console.log(`\n${"=".repeat(70)}`);
  console.log(`VERIFYING CONTRACTS ON: ${targetNetwork.toUpperCase()}`);
  console.log(`Chain ID: ${networkData.chainId}`);
  if (verifyOnly) {
    console.log(`Only verifying: ${verifyOnly.join(", ")}`);
  }
  console.log(`${"=".repeat(70)}`);
  
  const contracts = networkData.contracts;
  const results = [];
  
  // Helper to check if we should verify a contract
  const shouldVerify = (contractKey) => {
    return !verifyOnly || verifyOnly.includes(contractKey.toLowerCase());
  };
  
  // Verify based on which network
  if (targetNetwork === "cchain_testnet") {
    // Verify mpDAO
    if (contracts.mpdao && shouldVerify("mpdao")) {
      console.log(`\n${"─".repeat(70)}`);
      console.log("VERIFYING: mpDAO Token");
      console.log(`${"─".repeat(70)}`);
      const success = await verifyMpDao(contracts.mpdao, targetNetwork);
      results.push({ name: "mpDAO", success });
    }
    
    // Verify VotingPower
    if (contracts.votingPower && shouldVerify("votingPower")) {
      console.log(`\n${"─".repeat(70)}`);
      console.log("VERIFYING: VotingPower (Implementation + Proxy)");
      console.log(`${"─".repeat(70)}`);
      const success = await verifyVotingPower(contracts.votingPower);
      results.push({ name: "VotingPower", success });
    }
    
    // Verify PolicyGovernor
    if (contracts.policyGovernor && shouldVerify("policyGovernor")) {
      console.log(`\n${"─".repeat(70)}`);
      console.log("VERIFYING: PolicyGovernor");
      console.log(`${"─".repeat(70)}`);
      const success = await verifyPolicyGovernor(contracts.policyGovernor);
      results.push({ name: "PolicyGovernor", success });
    }
    
    // Verify PolicyServer
    if (contracts.policyServer && shouldVerify("policyServer")) {
      console.log(`\n${"─".repeat(70)}`);
      console.log("VERIFYING: PolicyServer");
      console.log(`${"─".repeat(70)}`);
      const success = await verifyPolicyServer(contracts.policyServer);
      results.push({ name: "PolicyServer", success });
    }
  } else if (targetNetwork === "beam_testnet") {
    // Verify BeamAsset
    if (contracts.beamAsset && shouldVerify("beamAsset")) {
      console.log(`\n${"─".repeat(70)}`);
      console.log("VERIFYING: BeamAsset (Mock)");
      console.log(`${"─".repeat(70)}`);
      const success = await verifyBeamAsset(contracts.beamAsset);
      results.push({ name: "BeamAsset", success });
    }
    
    // Verify StBEAMVault
    if (contracts.stBeamVault && shouldVerify("stBeamVault")) {
      console.log(`\n${"─".repeat(70)}`);
      console.log("VERIFYING: StBEAMVault");
      console.log(`${"─".repeat(70)}`);
      const success = await verifyStBeamVault(contracts.stBeamVault, networkData);
      results.push({ name: "StBEAMVault", success });
    }
    
    // Verify Mock PolicyClient
    if (contracts.policyClient && shouldVerify("policyClient")) {
      console.log(`\n${"─".repeat(70)}`);
      console.log("VERIFYING: MockPolicyClient");
      console.log(`${"─".repeat(70)}`);
      const success = await verifyMockPolicyClient(contracts.policyClient);
      results.push({ name: "MockPolicyClient", success });
    }
    
    // Verify Real PolicyClient
    if (contracts.realPolicyClient && shouldVerify("realPolicyClient")) {
      console.log(`\n${"─".repeat(70)}`);
      console.log("VERIFYING: PolicyClient (Real)");
      console.log(`${"─".repeat(70)}`);
      const success = await verifyPolicyClient(contracts.realPolicyClient);
      results.push({ name: "PolicyClient", success });
    }
  }
  
  // Print summary
  console.log(`\n${"=".repeat(70)}`);
  console.log("VERIFICATION SUMMARY");
  console.log(`${"=".repeat(70)}`);
  
  results.forEach(({ name, success }) => {
    const icon = success ? "✓" : "✗";
    console.log(`${icon} ${name}`);
  });
  
  const successCount = results.filter(r => r.success).length;
  console.log(`\nTotal: ${successCount}/${results.length} contracts verified`);
  console.log(`${"=".repeat(70)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
