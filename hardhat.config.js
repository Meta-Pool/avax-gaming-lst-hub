require("@nomicfoundation/hardhat-toolbox");
const fs = require("fs");
const path = require("path");

loadEnvFile();

function loadEnvFile() {
  const envPath = path.resolve(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getAccounts() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    return [];
  }

  if (!privateKey.startsWith("0x")) {
    throw new Error("PRIVATE_KEY must be a 0x-prefixed hex string");
  }

  return [privateKey];
}

const accounts = getAccounts();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    cchain: {
      url: process.env.RPC_CCHAIN || "http://127.0.0.1:9650/ext/bc/C/rpc",
      accounts,
    },
    dfk: {
      url: process.env.RPC_DFK || "http://127.0.0.1:9652/ext/bc/DFK/rpc",
      accounts,
    },
    beam: {
      url: process.env.RPC_BEAM || "http://127.0.0.1:9654/ext/bc/BEAM/rpc",
      accounts,
    },
  },
};
