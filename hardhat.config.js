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
  const privateKey = process.env.PRIVATE_KEY?.trim();
  if (!privateKey || privateKey.length === 0) {
    return [];
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    console.warn(
      "Ignoring PRIVATE_KEY: expected 0x-prefixed 32-byte hex string"
    );
    return [];
  }

  return [privateKey];
}

const accounts = getAccounts();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    cchain_testnet: {
      url:
        process.env.RPC_CCHAIN_TESTNET ||
        process.env.RPC_CCHAIN ||
        "http://127.0.0.1:8545",
      accounts,
    },
    dfk_testnet: {
      url:
        process.env.RPC_DFK_TESTNET ||
        process.env.RPC_DFK ||
        "http://127.0.0.1:8545",
      accounts,
    },
    beam_testnet: {
      url:
        process.env.RPC_BEAM_TESTNET ||
        process.env.RPC_BEAM ||
        "http://127.0.0.1:8545",
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      cchain_testnet: process.env.SNOWTRACE_API_KEY || "snowtrace", // Fuji testnet
      beam_testnet: process.env.SNOWTRACE_API_KEY || "snowtrace", // Beam subnet
      dfk_testnet: process.env.SNOWTRACE_API_KEY || "snowtrace", // DFK subnet
    },
    customChains: [
      {
        network: "cchain_testnet",
        chainId: 43113,
        urls: {
          apiURL: "https://api-testnet.snowtrace.io/api",
          browserURL: "https://testnet.snowtrace.io"
        }
      },
      {
        network: "beam_testnet",
        chainId: 13337,
        urls: {
          apiURL: "https://subnets-test.avax.network/beam/block-explorer/api",
          browserURL: "https://subnets-test.avax.network/beam"
        }
      },
      {
        network: "dfk_testnet",
        chainId: 335,
        urls: {
          apiURL: "https://subnets-test.avax.network/defi-kingdoms/block-explorer/api",
          browserURL: "https://subnets-test.avax.network/defi-kingdoms"
        }
      }
    ]
  },
  sourcify: {
    enabled: false
  }
};
