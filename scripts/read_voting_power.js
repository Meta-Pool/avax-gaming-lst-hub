const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function getDeploymentsPath() {
  const custom = process.env.DEPLOYMENTS_FILE;
  return custom && custom.length > 0
    ? path.resolve(process.cwd(), custom)
    : path.resolve(process.cwd(), "deployments.json");
}

function readVotingPowerAddress(filePath, currentNetwork) {
  const { ethers } = hre;

  if (!fs.existsSync(filePath)) {
    throw new Error(`deployments file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  const addr = data?.networks?.[currentNetwork]?.contracts?.votingPower?.proxy;
  if (!addr || !ethers.isAddress(addr)) {
    throw new Error(
      `votingPower address missing in deployments for network ${currentNetwork}`
    );
  }

  return {
    proxy: addr,
    mpdao: data?.networks?.[currentNetwork]?.contracts?.votingPower?.mpdao,
  };
}

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

async function main() {
  const { ethers, network } = hre;

  if (network.name !== "cchain_testnet") {
    throw new Error(
      `This script is intended for cchain_testnet. Current network: ${network.name}`
    );
  }

  const deploymentsPath = getDeploymentsPath();
  const { proxy: vpAddress, mpdao: mpdaoAddress } = readVotingPowerAddress(
    deploymentsPath,
    network.name
  );

  // Get the address to check from command line args or env var
  const addressToCheck = process.env.CHECK_ADDRESS || process.argv[2];

  // Just need a provider, no signer required for read-only operations
  const votingPower = await ethers.getContractAt("VotingPowerV1", vpAddress);

  console.log(`VotingPower Contract: ${vpAddress}`);
  console.log(`Linked mpDAO Token: ${mpdaoAddress}`);
  console.log("═".repeat(70));

  // Get global stats
  const [totalVP, totalMpDAO, boundMpDAO] = await Promise.all([
    votingPower.totalVotingPower(),
    votingPower.totalMpDAO(),
    votingPower.mpDAO(),
  ]);

  console.log("\n📊 Global Statistics:");
  console.log(`Total Voting Power: ${ethers.formatUnits(totalVP, 6)}`);
  console.log(`Total mpDAO Locked: ${ethers.formatUnits(totalMpDAO, 6)}`);
  console.log(`mpDAO Token Address: ${boundMpDAO}`);

  // If an address is provided, show detailed user info
  if (addressToCheck) {
    if (!ethers.isAddress(addressToCheck)) {
      throw new Error(`Invalid address: ${addressToCheck}`);
    }

    console.log("\n" + "═".repeat(70));
    console.log(`\n👤 Account Details: ${addressToCheck}`);
    console.log("─".repeat(70));

    const [user, unlockAmounts] = await Promise.all([
      votingPower.getUser(addressToCheck),
      votingPower.getUnlockAmount(addressToCheck),
    ]);

    console.log(`\n💪 Voting Power: ${ethers.formatUnits(user.votingPower, 6)}`);
    console.log(`🔒 Total Locked: ${ethers.formatUnits(user.mpDaoBalance, 6)} mpDAO`);

    if (totalVP > 0n) {
      const vpPercentage = (Number(user.votingPower) / Number(totalVP) * 100).toFixed(4);
      console.log(`📈 % of Total VP: ${vpPercentage}%`);
    }

    // Show locked positions
    if (user.lps.length > 0) {
      console.log(`\n🔐 Locked Positions (${user.lps.length}):`);
      for (const [index, lp] of user.lps.entries()) {
        const amount = ethers.formatUnits(lp.amount, 6);
        console.log(`  ${index + 1}. ${amount} mpDAO locked for ${lp.lockedDays} days`);
      }
    } else {
      console.log("\n🔐 Locked Positions: None");
    }

    // Show unlocking positions
    const [unlocking, unlocked] = unlockAmounts;
    if (user.ulps.length > 0) {
      console.log(`\n🔓 Unlocking Positions (${user.ulps.length}):`);
      const now = Math.floor(Date.now() / 1000);
      for (const [index, ulp] of user.ulps.entries()) {
        const amount = ethers.formatUnits(ulp.amount, 6);
        const releaseDate = new Date(Number(ulp.releaseDate) * 1000).toISOString();
        const secondsRemaining = Number(ulp.releaseDate) - now;
        
        if (secondsRemaining > 0) {
          const timeLeft = formatDuration(secondsRemaining);
          console.log(`  ${index + 1}. ${amount} mpDAO - unlocks in ${timeLeft} (${releaseDate})`);
        } else {
          console.log(`  ${index + 1}. ${amount} mpDAO - ✅ Ready to withdraw (${releaseDate})`);
        }
      }
      
      console.log(`\n  📦 Unlocking: ${ethers.formatUnits(unlocking, 6)} mpDAO`);
      console.log(`  ✅ Unlocked: ${ethers.formatUnits(unlocked, 6)} mpDAO (ready to withdraw)`);
    } else {
      console.log("\n🔓 Unlocking Positions: None");
    }
  } else {
    console.log("\n💡 Tip: Provide an address to see detailed user information:");
    console.log("   CHECK_ADDRESS=0x... npx hardhat run scripts/read_voting_power.js --network cchain_testnet");
  }

  console.log("\n" + "═".repeat(70));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
