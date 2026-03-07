# Contract Verification Guide

This guide explains how to verify your deployed contracts on Snowtrace (Avalanche's block explorer).

## Prerequisites

1. **Get a Snowtrace API Key** (Optional but recommended):
   - Visit https://snowtrace.io/register
   - Create an account and generate an API key
   - Add it to your `.env` file:
     ```
     SNOWTRACE_API_KEY=your_api_key_here
     ```
   - Note: Verification works without an API key, but with rate limits

2. **Ensure your contracts are deployed**:
   - Check `deployments.json` to see your deployed contracts

## Quick Start

### Verify C-Chain (Fuji Testnet) Contracts

To verify all contracts on C-Chain testnet:

```bash
npm run verify:cchain
```

This will verify:
- ✓ mpDAO Token
- ✓ VotingPower (Implementation + Proxy)
- ✓ PolicyGovernor
- ✓ PolicyServer

### Verify Only Specific Contracts

To verify only specific contracts (saves API calls):

```bash
# Verify only PolicyGovernor
VERIFY_ONLY=policyGovernor npm run verify:cchain

# Verify only mpDAO
VERIFY_ONLY=mpdao npm run verify:cchain

# Verify multiple specific contracts
VERIFY_ONLY=policyGovernor,policyServer npm run verify:cchain
```

Available contract names for C-Chain:
- `mpdao`
- `votingPower`
- `policyGovernor`
- `policyServer`

Available contract names for Beam:
- `beamAsset`
- `stBeamVault`
- `policyClient` (MockPolicyClient)
- `realPolicyClient` (Real cross-chain PolicyClient)

### Verify Beam Testnet Contracts

⚠️ **Note:** BEAM subnet explorer doesn't currently support automated verification API. Contracts need to be verified manually through the explorer UI or you can use Sourcify.

**Option 1: Manual Verification (Recommended)**

1. Generate flattened source code:
   ```bash
   npm run flatten:mock-client
   ```

2. Visit the BEAM explorer: https://subnets-test.avax.network/beam
3. Navigate to your contract address
4. Click on "Contract" tab
5. Click "Verify & Publish"
6. Fill in the details:
   - Compiler: `v0.8.24+commit.e11b9ed9`
   - Optimization: Enabled (200 runs)
   - Contract Name: `MockPolicyClient`
   - Source Code: Copy from `MockPolicyClient_flat.sol`

**Option 2: Use Sourcify**

Sourcify provides decentralized verification:

```bash
# Enable Sourcify in hardhat.config.js (already configured)
npx hardhat verify --network beam_testnet <CONTRACT_ADDRESS>
```

**Contracts to verify manually on BEAM:**
- MockPolicyClient: `0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583`
- StBEAMVault: `0x16A289aF7727Bfc3A2c4bda7993568D8A3148c48`
- WBEAM: `0x244AfCd5a0bc8A4400c6702C6a2A7717945c5e70`

### Verify C-Chain Contracts (Works with API)

## Manual Verification (Single Contract)

If you want to verify a specific contract manually:

```bash
npx hardhat verify --network cchain_testnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

### Example: Verify mpDAO Token

For the mpDAO token at `0x31e0752Deb99f1fCE9701Dc5611A1652189dEdC3`:

```bash
npx hardhat verify \
  --network cchain_testnet \
  --contract contracts/MpDaoToken.sol:MpDaoToken \
  0x31e0752Deb99f1fCE9701Dc5611A1652189dEdC3 \
  "Meta Pool DAO" \
  "mpDAO" \
  "0xe9C733bDe70B8512449eEC3323542b0F42A1a484" \
  "0"
```

## Understanding Constructor Arguments

The verification script automatically reads from `deployments.json` and determines the correct constructor arguments for each contract:

### mpDAO Token
```javascript
constructor(name, symbol, owner, initialSupply)
// Example: ["Meta Pool DAO", "mpDAO", "0xe9C73...", "0"]
```

### VotingPower Proxy
```javascript
// Implementation has no constructor args
// Proxy: constructor(implementation, initData)
```

### PolicyGovernor
```javascript
constructor(
  votingPower,
  epochSeconds,
  startTimestamp,
  useQuorumBps,
  quorumValue,
  validatorIds
)
```

### PolicyServer
```javascript
constructor(policyGovernor, teleporterMessenger, owner)
```

### PolicyClient
```javascript
constructor(teleporterMessenger, owner)
```

### MockPolicyClient
```javascript
// No constructor arguments - simple deployment
constructor()
```

### StBEAMVault
```javascript
constructor(
  asset,
  policyClient,
  policyEpochSeconds,
  policyStartTimestamp,
  depositFeeBps,
  owner,
  feeMode
)
```

## Troubleshooting

### "Already Verified"
If a contract is already verified, the script will skip it and continue with the next one.

### "Failed to verify"
Common causes:
- Incorrect constructor arguments
- Contract source code doesn't match deployed bytecode
- Network configuration issues
- API rate limiting (get a Snowtrace API key)

### Verify with different deployments file
If you have multiple deployment files:

```bash
DEPLOYMENTS_FILE=deployments.backup.json npm run verify:cchain
```

## Explorer Links

After verification, view your contracts on:

- **C-Chain Testnet (Fuji)**: https://testnet.snowtrace.io/address/YOUR_ADDRESS
- **Beam Testnet**: https://subnets-test.avax.network/beam/address/YOUR_ADDRESS

## Script Details

The verification script is located at `scripts/verify_contracts.js` and:
- Reads deployment info from `deployments.json`
- Automatically determines constructor arguments
- Verifies each contract on the appropriate network
- Provides a summary of verification results

You can also customize the network:
```bash
VERIFY_NETWORK=cchain_testnet npx hardhat run scripts/verify_contracts.js --network cchain_testnet
```
