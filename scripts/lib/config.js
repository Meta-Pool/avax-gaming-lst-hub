const fs = require("fs");
const path = require("path");

const NETWORK_KEYS = ["cchain", "dfk", "beam"];

const RPC_ENV_BY_NETWORK = {
  cchain: "RPC_CCHAIN",
  dfk: "RPC_DFK",
  beam: "RPC_BEAM",
};

const MESSENGER_ENV_BY_NETWORK = {
  cchain: "TELEPORTER_MESSENGER_CCHAIN",
  dfk: "TELEPORTER_MESSENGER_DFK",
  beam: "TELEPORTER_MESSENGER_BEAM",
};

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
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

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function validatePrivateKey(privateKey) {
  if (!privateKey.startsWith("0x")) {
    throw new Error("PRIVATE_KEY must be a 0x-prefixed hex string");
  }
}

function getRuntimeConfig() {
  loadEnvFile();

  const privateKey = requireEnv("PRIVATE_KEY");
  validatePrivateKey(privateKey);

  const networks = {};
  for (const key of NETWORK_KEYS) {
    networks[key] = {
      key,
      rpcUrl: requireEnv(RPC_ENV_BY_NETWORK[key]),
      messenger: requireEnv(MESSENGER_ENV_BY_NETWORK[key]),
    };
  }

  return {
    privateKey,
    networks,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }
  return args;
}

function ensureNetworkKey(value, fieldName) {
  if (!NETWORK_KEYS.includes(value)) {
    throw new Error(
      `${fieldName} must be one of: ${NETWORK_KEYS.join(", ")}. Received: ${value}`
    );
  }
  return value;
}

function getDeploymentsPath(customPath) {
  if (customPath) {
    return path.resolve(process.cwd(), customPath);
  }
  return path.resolve(process.cwd(), "deployments.json");
}

function readDeployments(customPath) {
  const filePath = getDeploymentsPath(customPath);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Deployments file not found: ${filePath}. Run scripts/deploy-all.js first.`
    );
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeDeployments(data, customPath) {
  const filePath = getDeploymentsPath(customPath);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return filePath;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  NETWORK_KEYS,
  ensureNetworkKey,
  getRuntimeConfig,
  parseArgs,
  readDeployments,
  sleep,
  writeDeployments,
};
