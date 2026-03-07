# How to Run the Demo

Complete step-by-step guide for deploying and testing the cross-chain governance system.

---

## Prerequisites

1. **Install dependencies and compile:**
   ```bash
   npm install
   npx hardhat compile
   ```

2. **Configure `.env`:**
   ```bash
   PRIVATE_KEY=0x...
   RPC_CCHAIN_TESTNET=https://api.avax-test.network/ext/bc/C/rpc
   RPC_BEAM_TESTNET=https://build.onbeam.com/rpc/testnet
   SNOWTRACE_API_KEY=your_api_key  # optional
   ```

3. **Verify network connectivity:**
   ```bash
   npm run smoke:cchain
   npm run smoke:beam
   ```

---

## Part 1: Deploy Governance on C-Chain

### Step 1: Deploy mpDAO Token

```bash
npm run deploy:mpdao
```

**Verify:**
```bash
CHECK_ADDRESS=<your_address> npm run check_mpdao_balance.js --network cchain_testnet
```

### Step 2: Mint Tokens

```bash
npm run mint:mpdao
```

**Configuration (optional):**
- `MINT_ACCOUNT_1`, `MINT_ACCOUNT_2` — Recipient addresses
- `MINT_AMOUNT_1`, `MINT_AMOUNT_2` — Amounts (default: 1000)

---

### Step 3: Deploy VotingPower Contract

```bash
npm run deploy:voting-power
```

**Verify:**
```bash
npm run read:voting-power
```

---

### Step 4: Stake mpDAO for Voting Power

```bash
npm run stake:vp
```

**Configuration (optional):**
- `STAKE_AMOUNT` — Tokens to lock (default: 1000)
- `STAKE_LOCK_DAYS` — Lock duration, 30-300 days (default: 30)

**Verify:**
```bash
CHECK_ADDRESS=<your_address> npx hardhat run scripts/read_voting_power.js --network cchain_testnet
```

---

### Step 5: Deploy PolicyGovernor

```bash
npm run deploy:policy-governor
```

**Configuration (optional):**
- `EPOCH_SECONDS` — Duration (default: 604800 = 7 days)
- `QUORUM_MODE` — BPS or ABSOLUTE (default: BPS)
- `QUORUM_VALUE` — Required votes (default: 5000 = 50%)
- `VALIDATOR_IDS` — Comma-separated IDs (default: 1,2,3,4)

**Verify:**
```bash
npm run read:cchain-policy
```

---

### Step 6: Vote and Finalize Policy

**Cast votes:**
```bash
npm run vote:policy
```

**Configuration (optional):**
- `VOTE_WEIGHTS` — Comma-separated BPS values summing to 10000 (default: 6000,3000,900,100)

**Finalize the epoch:**
```bash
npm run finalize:epoch
```

**Verify policy:**
```bash
npm run read:cchain-policy
```

**Expected:** Policy for epoch 1 finalized with weights summing to 10000 BPS.

---

## Part 2: Deploy Execution on BEAM

### Step 7: Deploy StBEAM Vault

```bash
npm run deploy:beam-vault
```

**Configuration (optional):**
- `DEPOSIT_FEE_BPS` — Fee on deposits (default: 100 = 1%)
- `POLICY_EPOCH_SECONDS` — Epoch duration (default: 60s for testing)
- `BEAM_ASSET_ADDRESS` — Existing WBEAM address (otherwise deploys mock)
- `POLICY_CLIENT_ADDRESS` — Existing mock client (otherwise deploys new)

**Verify:**
```bash
npm run read:beam-vault
```

---

### Step 8: Update Vault Policy Client

Ensure vault points to the correct MockPolicyClient:

```bash
npm run vault:use-mock
```

---

### Step 9: (Optional) Sync Mock Policy with Governance

To match the policy you voted for on C-Chain:

```bash
UPDATE_POLICY_EPOCH=1 UPDATE_POLICY_WEIGHTS_BPS=6000,3000,900,100 npx hardhat run scripts/update_mock_policy.js --network beam_testnet
```

---

### Step 10: Stake WBEAM

```bash
STAKE_BEAM_AMOUNT=100 npx hardhat run scripts/stake_beam.js --network beam_testnet
```

**What happens:**
- Deposits WBEAM into vault
- Charges 1% fee (goes to feeAccumulator)
- Distributes remaining 99% across validator buckets per policy weights
- Mints stBEAM shares to your address
- Emits `PolicyApplied` and `BucketsUpdated` events

**Verify distribution:**
```bash
npx hardhat run scripts/verify_policy_distribution.js --network beam_testnet
```

**Expected:**
- Buckets match policy weights (e.g., 60%, 30%, 9%, 1%)
- All percentages sum to 100%

---

## Part 3: Inspection Commands

### C-Chain State

```bash
# Policy and governance state
npm run read:cchain-policy

# Voting power for specific address
CHECK_ADDRESS=0x... npx hardhat run scripts/read_voting_power.js --network cchain_testnet

# mpDAO balance
CHECK_ADDRESS=0x... npm run check_mpdao_balance.js --network cchain_testnet
```

### BEAM State

```bash
# Complete vault state and buckets
npm run read:beam-vault

# Policy distribution verification
npx hardhat run scripts/verify_policy_distribution.js --network beam_testnet

# WBEAM/stBEAM balances
CHECK_ADDRESS=0x... npx hardhat run scripts/check_beam_balances.js --network beam_testnet

# PolicyClient state
npx hardhat run scripts/read_policy_client.js --network beam_testnet
```

---

## Part 4: Advanced - Real Cross-Chain Setup (Optional)

**⚠️ Only for production testing. Requires sufficient testnet tokens and working Teleporter relayers.**

### Deploy PolicyServer on C-Chain

```bash
npx hardhat run scripts/deploy_policy_server.js --network cchain_testnet
```

### Deploy Real PolicyClient on BEAM

```bash
npx hardhat run scripts/deploy_policy_client.js --network beam_testnet
```

### Configure Cross-Chain Trust

```bash
# Allow PolicyClient to request from PolicyServer
npm run set:policy-server-peers

# Allow PolicyServer to respond to PolicyClient
npm run set:policy-client-peers
```

### Switch Vault to Real Client

```bash
npm run vault:use-real
```

### Request Policy Cross-Chain

```bash
npx hardhat run scripts/request_policy_crosschain.js --network beam_testnet
```

**Note:** Requires Teleporter relayers to process messages (may take 30s-few minutes).

---

## Troubleshooting

### "Quorum not reached"
Ensure you have enough voting power staked and that votes were cast before finalizing.

### "Policy not found for epoch"
The vault uses `currentEpoch - 1` for policy. Ensure that epoch is finalized on C-Chain.

### "Insufficient WBEAM balance"
The stake_beam script should auto-mint if needed. Check your WBEAM balance manually.

### "Vault pointing to wrong client"
Run `npm run vault:use-mock` to reset to MockPolicyClient.

### Bucket distribution doesn't match policy
Run `npm run verify:policy-distribution` to see detailed comparison and identify any mismatches.

---

## Summary

**Quick path for demos (using MockPolicyClient):**
1. Deploy governance on C-Chain (steps 1-6)
2. Deploy vault on BEAM (step 7)
3. Configure mock client (steps 8-9)
4. Test staking (step 10)

**Full cross-chain setup (optional):**
- Complete Part 4 to enable real Teleporter-based policy distribution
- Only recommended when you have reliable relayers and sufficient testnet tokens