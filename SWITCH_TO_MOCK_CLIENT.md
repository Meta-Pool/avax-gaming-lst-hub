# Switching Back to MockPolicyClient (Demo Mode)

## What Changed

The system has been configured to use **MockPolicyClient** instead of the real **PolicyClient** for demo purposes. This ensures the demo works reliably without depending on Testnet Teleporter relayers.

## Changes Made

### 1. Updated `update_vault_policy_client.js`
- Added `USE_MOCK_CLIENT` environment variable support
- When `USE_MOCK_CLIENT=true`, prioritizes MockPolicyClient
- When `USE_MOCK_CLIENT=false`, prioritizes real PolicyClient

### 2. Updated `deployments.json`
- Changed vault's `policyClient` from `0x63b52c20bf7e41429399493fC247530594b100d8` (real)
- To `0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583` (mock)

### 3. Updated `package.json`
Added convenient npm scripts:
- `npm run vault:use-mock` - Switch vault to MockPolicyClient
- `npm run vault:use-real` - Switch vault to real PolicyClient

### 4. Updated `PROOF_OF_WORK.md`
- Changed PolicyClient reference to MockPolicyClient
- Added note explaining demo mode choice

## Action Required: Update On-Chain State

⚠️ **Important:** The vault contract on BEAM still points to the real PolicyClient. You need to update it on-chain.

### Run This Command:

```bash
npm run vault:use-mock
```

Or manually:

```bash
USE_MOCK_CLIENT=true npx hardhat run scripts/update_vault_policy_client.js --network beam_testnet
```

**This will:**
1. Connect to the StBEAMVault contract
2. Call `setPolicyClient()` to update to MockPolicyClient address
3. Verify the change was successful
4. Update `deployments.json` to reflect the change

### Expected Output:

```
══════════════════════════════════════════════════════════════════
🔄 UPDATE VAULT POLICY CLIENT
══════════════════════════════════════════════════════════════════
Network: beam_testnet
Deployer: 0xe9C733bDe70B8512449eEC3323542b0F42A1a484
Vault: 0x16A289aF7727Bfc3A2c4bda7993568D8A3148c48
New PolicyClient: 0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583
Client Type: MockPolicyClient
USE_MOCK_CLIENT: true (forcing mock)
⚠️  Using MockPolicyClient (testing/demo mode)
...
✅ VAULT POLICY CLIENT UPDATE COMPLETE
```

## Verification

After updating, verify the vault is using the correct client:

```bash
npm run read:beam-vault
```

Look for:
```
policyClient: 0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583
  type: MockPolicyClient
```

### Verify MockPolicyClient on Block Explorer

⚠️ **Note:** BEAM subnet explorer doesn't support automated verification API yet.

**Manual Verification Steps:**

1. **Generate flattened source:**
   ```bash
   npm run flatten:mock-client
   ```

2. Visit: https://subnets-test.avax.network/beam/address/0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583
3. Click "Contract" → "Verify & Publish"
4. Enter contract details:
   - Compiler: `v0.8.24+commit.e11b9ed9`
   - Optimization: Enabled (200 runs)
   - Contract Name: `MockPolicyClient`
   - Source Code: Copy from `MockPolicyClient_flat.sol`

**Note:** The source code is simple (no external dependencies), so you can also paste directly from `contracts/mocks/MockPolicyClient.sol` if preferred.

## Why MockPolicyClient for Demo?

| Advantage | Description |
|-----------|-------------|
| 🎯 **Reliability** | No dependency on Teleporter relayer uptime |
| 💰 **No Token Requirements** | No cross-chain message fees needed |
| ⚡ **Instant Policy** | Hardcoded policy available immediately |
| 🔧 **Easier Testing** | Can modify mock policy anytime without governance |
| 👨‍💻 **Demo Ready** | Perfect for hackathon presentations |

## MockPolicyClient Features

The MockPolicyClient at `0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583`:

- Has a default policy for 4 validators (25% each: 2500 BPS)
- Can be updated via `setPolicy(epoch, validatorIds, weights)` by owner
- Implements same interface as real PolicyClient
- Returns policy instantly without cross-chain calls

## When to Switch to Real PolicyClient

Switch back to real PolicyClient when:
- Testnet Teleporter relayers are confirmed working
- You have sufficient testnet tokens for cross-chain fees
- You want to demonstrate full cross-chain governance flow
- You're ready for production-like testing

To switch back:

```bash
npm run vault:use-real
```

## Deployed Addresses Reference

**C-Chain (Fuji):**
- PolicyGovernor: `0x19Af9A1F3f276e4F4A708Aca04E5B2Ea1520D08E`
- PolicyServer: `0x4A8C4229642215aB4F035Bc4A732cB918E74B283`

**BEAM Testnet:**
- MockPolicyClient: `0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583` ✅ **Using This**
- Real PolicyClient: `0x63b52c20bf7e41429399493fC247530594b100d8`
- StBEAMVault: `0x16A289aF7727Bfc3A2c4bda7993568D8A3148c48`
- WBEAM: `0x244AfCd5a0bc8A4400c6702C6a2A7717945c5e70`
