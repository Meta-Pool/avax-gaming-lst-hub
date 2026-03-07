# End-to-End Execution Runbook

## 0. Prepare the environment

Before deploying anything, make sure you have:

- `.env` configured with:
  - `PRIVATE_KEY`
  - `RPC_CCHAIN`
  - `RPC_BEAM`
  - Teleporter / messenger addresses
- Dependencies installed
- Contracts compiled

**Run:**

```bash
npm install
npx hardhat compile
```

**Then verify both networks are reachable:**

```bash
npx hardhat run scripts/smoke.js --network cchain_testnet
npx hardhat run scripts/smoke.js --network beam_testnet
```


## 1. Deploy mpDAO on C-Chain

This is the first on-chain component of the governance system.

**Run:**

```bash
npx hardhat run scripts/deploy_mpdao.js --network cchain_testnet
```

**What this should do:**

- Deploy the mock mpDAO ERC20
- Save the deployed address into `deployments.json`

**Then verify it:**

```bash
CHECK_ADDRESS=0xe9C733bDe70B8512449eEC3323542b0F42A1a484 npx hardhat run scripts/check_mpdao_balance.js --network cchain_testnet
```

**Expected result:**

- mpDAO address is present in deployments

## 2. Mint mpDAO to test users

Now fund the accounts that will participate in governance.

**Run:**

```bash
npx hardhat run scripts/mint_mpdao.js --network cchain_testnet
```

**What this should do:**

- Mint mpDAO to one or more test wallets
- Print balances

**Then verify:**

```bash
CHECK_ADDRESS=0xe9C733bDe70B8512449eEC3323542b0F42A1a484 npx hardhat run scripts/check_mpdao_balance.js --network cchain_testnet
```

**Expected result:**

- User A has mpDAO
- Optionally User B has mpDAO

## 3. Deploy the Voting Power contract on C-Chain

This is the staking/locking contract that gives governance weight.

**Run:**

```bash
npx hardhat run scripts/deploy_voting_power.js --network cchain_testnet
```

**What this should do:**

- Deploy the Voting Power contract (implementation + proxy)
- Save its address in `deployments.json`

**Then verify:**

```bash
npx hardhat run scripts/read_voting_power.js --network cchain_testnet
```

Or check a specific account:

```bash
CHECK_ADDRESS=0xe9C733bDe70B8512449eEC3323542b0F42A1a484 npx hardhat run scripts/read_voting_power.js --network cchain_testnet
```

**Expected result:**

- Contract deployed with proxy pattern
- Linked to mpDAO token
- Global statistics displayed (total voting power, total locked mpDAO)

## 4. Approve and stake mpDAO into Voting Power

Now create actual voting power.

**Run:**

```bash
npx hardhat run scripts/stake_for_vp.js --network cchain_testnet
```

**What this should do:**

- Check deployer's mpDAO balance (mint if needed)
- Approve VotingPower contract to spend mpDAO
- Lock/stake mpDAO for the deployer account
- Create Voting Power based on lock duration (default: 30 days, 1000 mpDAO)

**Then verify:**

```bash
CHECK_ADDRESS=0xe9C733bDe70B8512449eEC3323542b0F42A1a484 npx hardhat run scripts/read_voting_power.js --network cchain_testnet
```

**Expected result:**

- Deployer account now has Voting Power > 0
- Locked position visible with lock duration and amount
- VP reflects the lock/stake amount and duration

## 5. Deploy PolicyGovernor on C-Chain

This contract will collect votes and finalize the delegation policy for each epoch.

**Run:**

```bash
npx hardhat run scripts/deploy_policy_governor.js --network cchain_testnet
```

**What this should do:**

- Deploy the PolicyGovernor contract
- Configure:
  - Epoch duration (default: 7 days)
  - Quorum mode and value (default: BPS mode, 50%)
  - Validator IDs (default: [1, 2, 3, 4])
- Link to VotingPower contract
- Save address to `deployments.json`

**Configuration options (environment variables):**

```bash
EPOCH_SECONDS=604800        # 7 days default
QUORUM_MODE=BPS             # or ABSOLUTE
QUORUM_VALUE=5000           # 50% in BPS, or absolute voting power
VALIDATOR_IDS=1,2,3,4       # Comma-separated validator IDs
```

**Then verify:**

```bash
npx hardhat run scripts/read_cchain_policy.js --network cchain_testnet
```

**Expected result:**

- PolicyGovernor deployed and linked to VotingPower
- Validator set is loaded correctly
- Epoch duration is configured (7 days = 604800 seconds)
- Quorum settings are correct (mode and value)
- Current epoch is 1 (no finalized policies yet)

## 6. Cast governance votes on C-Chain

Now use the previously created VP to vote on weights.

**Run:**

```bash
npx hardhat run scripts/vote_policy.js --network cchain_testnet
```

**What this should do:**

- Cast votes for validator weights (in basis points, must sum to 10000)
- Default weights: Validator 1 = 6000 BPS (60%), Validator 2 = 3000 BPS (30%), Validator 3 = 900 BPS (9%), Validator 4 = 100 BPS (1%)
- Check voter's voting power
- Record the vote for the current epoch
- Display quorum status

**Configuration options:**

```bash
VOTE_WEIGHTS=6000,3000,900,100  # Custom weights in basis points (must sum to 10000)
```

**Then finalize the epoch if quorum is reached:**

```bash
npx hardhat run scripts/finalize_epoch.js --network cchain_testnet
```

**What this should do:**

- Check if quorum is reached for the current epoch
- Finalize the epoch if requirements are met
- Compute and store the final weighted policy
- Display the finalized validator weights

**Then verify:**

```bash
npx hardhat run scripts/read_cchain_policy.js --network cchain_testnet
```

**Expected result:**

- A finalized policy exists for epoch 1
- The weights sum to 10000 BPS (100%)
- The finalized epoch is visible with voter statistics
- Policy weights reflect the voted distribution

## 7. Deploy the stBEAMVault on BEAM

Now move to the execution side on the BEAM network.

**Run:**

```bash
npx hardhat run scripts/deploy_beam_vault.js --network beam_testnet
```

**What this should do:**

- Deploy ERC-4626 vault (stBEAM) for liquid staking
- Deploy BeamAssetMock (WBEAM) or use existing asset if `BEAM_ASSET_ADDRESS` is set
- Deploy MockPolicyClient or use existing if `POLICY_CLIENT_ADDRESS` is set
- Configure deposit fee (default: 100 BPS = 1%)
- Configure policy epoch settings (default: 60 seconds for testing)
- Save all addresses to `deployments.json`

**Configuration options (environment variables):**

```bash
DEPOSIT_FEE_BPS=100                    # Fee on deposits (100 = 1%)
POLICY_EPOCH_SECONDS=60                # Epoch duration (60s for testing)
POLICY_START_TIMESTAMP=0               # 0 = use deployment time
BEAM_ASSET_ADDRESS=                    # Optional: existing asset address
POLICY_CLIENT_ADDRESS=                 # Optional: existing policy client
```

**Then verify:**

```bash
npx hardhat run scripts/read_beam_vault_and_buckets.js --network beam_testnet
```

**Expected result:**

- stBEAMVault deployed with correct configuration
- Asset (WBEAM) address linked correctly
- Deposit fee configured (1% default)
- Policy client linked
- Policy epoch settings correct (60s duration)
- Validator buckets initialized (empty initially)

## 8. Verify MockPolicyClient on BEAM (Testing Mode)

**Current State:** The vault deployed in step 7 is already using a **MockPolicyClient** for testing. This mock client has a hardcoded policy and doesn't require cross-chain communication, which saves testnet tokens and allows local testing.

**Verify the mock setup:**

```bash
npx hardhat run scripts/read_policy_client.js --network beam_testnet
```

**Expected result:**

- MockPolicyClient is deployed and linked to the vault
- Default policy is configured (usually 4 validators with equal 25% weights)
- No cross-chain setup required
- Everything works locally on BEAM

**Note:** This is the recommended setup for initial testing and hackathon demos. Once everything is working and you have testnet tokens available, you can upgrade to the real PolicyClient + PolicyServer setup (see section 9 below).

---

## 8.5. Understanding the Policy Architecture

This section explains why there are multiple policy-related contracts and when to use mocks vs. real implementations.

### **The Three Components:**

#### **1. PolicyGovernor (C-Chain Only)**
- **Purpose:** Collects votes from mpDAO holders and finalizes the delegation policy
- **Location:** C-Chain
- **Status:** ✅ Already deployed (step 5)
- **Mock needed?** No - governance always stays on C-Chain

**What it does:**
- Users vote with their voting power on how to distribute delegations
- When quorum is reached, the epoch is finalized
- Stores the finalized policy (validator IDs + weights in basis points)

---

#### **2. PolicyServer (C-Chain Only)**
- **Purpose:** Bridge between PolicyGovernor and cross-chain requests
- **Location:** C-Chain
- **Status:** ⏳ Not deployed yet (optional, needed for real cross-chain setup)
- **Mock needed?** No

**What it does:**
- Listens for incoming Teleporter messages from other chains
- Reads the policy from PolicyGovernor
- Sends the policy back via Teleporter to the requesting chain

**Flow:**
```
Request from BEAM → Teleporter → PolicyServer → PolicyGovernor (read)
                                      ↓
                               Response back → BEAM
```

---

#### **3. PolicyClient (BEAM)**
- **Purpose:** Requests and stores policies locally on BEAM
- **Location:** BEAM chain
- **Status:** 🔄 Using MockPolicyClient currently
- **Mock available?** ✅ Yes - **MockPolicyClient** (currently in use)

**What it does:**
- Requests current policy from C-Chain via Teleporter
- Receives and stores the policy locally
- Vault reads the policy from this client

**Why the mock exists:**

**MockPolicyClient = Testing without cross-chain complexity**

```
REAL FLOW (requires Teleporter relayers + testnet tokens):
Vault → PolicyClient → Teleporter → PolicyServer → PolicyGovernor
                         ↓ (cross-chain message)
                      Response back

MOCK FLOW (local testing, saves tokens):
Vault → MockPolicyClient (hardcoded policy, no cross-chain)
```

### **Current Setup (Steps 1-8):**

```
C-Chain:
├── PolicyGovernor ✅ (deployed, collects votes)
└── PolicyServer ❌ (not deployed - not needed for mock)

BEAM:
├── MockPolicyClient ✅ (deployed, has default policy)
└── Vault ✅ (using MockPolicyClient)
```

### **Full Setup (Optional - Section 9):**

```
C-Chain:
├── PolicyGovernor ✅ (deployed)
└── PolicyServer ⏳ (deploy when ready)

BEAM:
├── PolicyClient ⏳ (deploy when ready)
└── Vault 🔄 (update to use real PolicyClient)
```

### **When to use what:**

| Scenario | Use MockPolicyClient | Use Real PolicyClient |
|----------|---------------------|----------------------|
| Local testing | ✅ Recommended | ❌ Overkill |
| Hackathon demo | ✅ Safe choice | ⚠️ Risky (relayers must work) |
| Testnet with tokens | ⚠️ Works but limited | ✅ Recommended |
| Production | ❌ Never | ✅ Required |

---

## 9. Deploy Real Cross-Chain Policy System (Optional)

**⚠️ Only proceed if:**
- You have sufficient testnet tokens on both chains
- Teleporter relayers are confirmed working
- MockPolicyClient testing is complete

This section covers deploying and configuring the real PolicyServer + PolicyClient for cross-chain policy distribution.

### 9.1. Deploy PolicyServer on C-Chain

**Run:**

```bash
npx hardhat run scripts/deploy_policy_server.js --network cchain_testnet
```

**What this should do:**

- Deploy PolicyServer contract linked to PolicyGovernor
- Configure Teleporter messenger address
- Save address to `deployments.json`
- Update `POLICY_SERVER_ADDRESS` in `.env`

**Configuration options:**

```bash
TELEPORTER_MESSENGER_CCHAIN=0x...     # Teleporter on C-Chain (already in .env)
POLICY_GOVERNOR_ADDRESS=0x...         # From deployments.json (already deployed)
```

**Then verify:**

```bash
npx hardhat run scripts/read_policy_server.js --network cchain_testnet
```

**Expected result:**

- PolicyServer deployed and linked to PolicyGovernor
- Teleporter messenger configured
- Ready to receive requests (but no allowed sources yet)

---

### 9.2. Deploy PolicyClient on BEAM

**Run:**

```bash
npx hardhat run scripts/deploy_policy_client.js --network beam_testnet
```

**What this should do:**

- Deploy the real PolicyClient contract with Teleporter integration
- Configure request target (C-Chain PolicyServer address and chain ID)
- Configure allowed policy sources (C-Chain PolicyServer)
- Save contract address to `deployments.json`

**Configuration options:**

```bash
TELEPORTER_MESSENGER_BEAM=0x...       # Teleporter on BEAM (already in .env)
CCHAIN_ID=43113                       # C-Chain ID (already in .env)
POLICY_SERVER_ADDRESS=0x...           # From step 9.1 deployment
VAULT_ADDRESS=0x...                   # Existing vault (already in .env)
```

**Then verify:**

```bash
npx hardhat run scripts/read_policy_client.js --network beam_testnet
```

**Expected result:**

- PolicyClient deployed and configured
- Request target set to C-Chain PolicyServer
- Allowed policy source configured for C-Chain
- No policy stored yet (needs cross-chain request)

---

### 9.3. Configure Bidirectional Trust

Both contracts need to allow each other:

**On C-Chain (allow PolicyClient to request):**

```bash
npx hardhat run scripts/set_policy_server_peers.js --network cchain_testnet
```

**On BEAM (allow PolicyServer to respond):**

```bash
npx hardhat run scripts/set_policy_client_peers.js --network beam_testnet
```

**Expected result:**

- PolicyServer allows requests from BEAM PolicyClient
- PolicyClient allows responses from C-Chain PolicyServer
- Cross-chain communication enabled

---

### 9.4. Update Vault to Use Real PolicyClient

If your vault is still using MockPolicyClient, update it:

```bash
npx hardhat run scripts/update_vault_policy_client.js --network beam_testnet
```

**What this should do:**

- Update the vault's policy client address to the real PolicyClient
- Verify the change

**Expected result:**

- Vault now uses real PolicyClient
- Can request policies cross-chain
- Ready for production-style testing


## 10. Test With MockPolicyClient (Current Setup)

**⚠️ IMPORTANT:** If you're using **MockPolicyClient** (steps 1-8), you **DO NOT** need cross-chain trust configuration. The mock client works entirely locally on BEAM without Teleporter communication.

### 10.1. Fix Vault-Client Address Mismatch

First, update the vault to point to the correct MockPolicyClient address (this happened because the vault was deployed before the client):

```bash
npx hardhat run scripts/update_vault_policy_client.js --network beam_testnet
```

**What this should do:**

- Check current vault policy client address
- Update it to match the deployed MockPolicyClient
- Update `deployments.json` to reflect the change
- **Cost:** 1 transaction only (saves tokens!)

**Expected result:**

- Vault now points to the correct MockPolicyClient
- Address mismatch resolved

---

### 10.2. Verify MockPolicyClient Configuration

```bash
npx hardhat run scripts/read_policy_client.js --network beam_testnet
```

**Expected result:**

- Shows MockPolicyClient type
- Displays current policy (likely 4 validators with default weights)
- Shows last known epoch

---

### 10.3. (Optional) Update Mock Policy to Match Governance

If you want the mock to reflect the same policy you voted for on C-Chain:

```bash
UPDATE_POLICY_EPOCH=1 UPDATE_POLICY_WEIGHTS_BPS=6000,3000,900,100 npx hardhat run scripts/update_mock_policy.js --network beam_testnet
```

**What this should do:**

- Set policy for epoch 1
- Configure weights: Validator 1 = 60%, Validator 2 = 30%, Validator 3 = 9%, Validator 4 = 1%
- Update lastKnownEpoch

**Expected result:**

- Mock policy matches governance votes from step 6
- Vault can now use this policy for delegation

---

### 10.4. Stake WBEAM into Vault

Now stake (deposit) WBEAM tokens into the vault:

```bash
STAKE_BEAM_AMOUNT=100 npx hardhat run scripts/stake_beam.js --network beam_testnet
```

**What this should do:**

- Check your WBEAM balance (mint if needed)
- Approve WBEAM to the vault
- Deposit into vault (stake)
- Charge deposit fee (1% default)
- Apply current policy from PolicyClient
- Distribute assets to validator buckets according to policy weights
- Mint stBEAM shares to your address
- Show before/after state with detailed breakdown

**Configuration:**

```bash
STAKE_BEAM_AMOUNT=100  # Amount in WBEAM tokens to stake (default: 100)
```

**Expected result:**

- WBEAM approved and deposited
- 1% fee deducted (goes to feeAccumulator)
- Remaining 99% distributed to validator buckets
- Distribution matches policy weights (e.g., 60%, 30%, 9%, 1%)
- You receive stBEAM shares
- Events: `PolicyApplied` and `BucketsUpdated` emitted

---

### 10.5. Verify Policy Distribution

Verify that the vault distributed assets correctly according to the policy:

```bash
npx hardhat run scripts/verify_policy_distribution.js --network beam_testnet
```

**What this should do:**

- Read active policy from vault
- Read validator buckets
- Calculate expected distribution based on policy weights
- Compare actual vs expected for each validator
- Show percentage breakdown
- Verify totals match
- Compare with PolicyClient's stored policy

**Expected result:**

```
✅ All buckets match policy weights correctly!
✅ Policy weights sum to 100%
✅ The vault is distributing assets according to governance policy

Example output:
  Validator 1:
    Policy weight: 6000 BPS (60.00%)
    Actual amount: 59.4 WBEAM
    Actual %: 60.00%
    ✅ Match (within tolerance)
```

---

### 10.6. Read Full Vault State

Get a comprehensive view of the vault:

```bash
npx hardhat run scripts/read_beam_vault_and_buckets.js --network beam_testnet
```

**Expected result:**

- Complete vault configuration
- Total assets and total supply
- Fee accumulator balance
- All validator buckets with amounts
- Active policy details
- PolicyClient last known policy
- All data matches expected state

---

### 10.7. (Optional) Full Smoke Test

Run the complete smoke test (deposit + withdraw):

```bash
BEAM_VAULT_TEST_DEPOSIT=10 npx hardhat run scripts/beam_vault_smoke.js --network beam_testnet
```

**What this does:**

- Tests full deposit flow
- Tests withdrawal flow
- Verifies all accounting
- Good for regression testing

---

## 11. Configure Cross-Chain Trust (Only for Real PolicyClient)

**⚠️ SKIP THIS SECTION** if you're using MockPolicyClient for testing.

**Only proceed** if you've completed Section 9 (deploying PolicyServer + real PolicyClient) and want to enable actual cross-chain policy distribution.

### 11.1. Configure Bidirectional Trust

Both contracts need to allow each other to communicate via Teleporter:

**On C-Chain (allow BEAM PolicyClient to request policies):**

```bash
npx hardhat run scripts/set_policy_server_peers.js --network cchain_testnet
```

**On BEAM (allow C-Chain PolicyServer to respond):**

```bash
npx hardhat run scripts/set_policy_client_peers.js --network beam_testnet
```

**What this should configure:**

- PolicyServer on C-Chain allows requests from BEAM chain ID + PolicyClient address
- PolicyClient on BEAM allows responses from C-Chain ID + PolicyServer address
- Bidirectional trust established

**Expected result:**

- C-Chain PolicyServer knows about BEAM PolicyClient
- BEAM PolicyClient knows about C-Chain PolicyServer
- Cross-chain allowlists configured correctly
- Ready for Teleporter message exchange

---

### 11.2. Verify Cross-Chain Configuration

```bash
npx hardhat run scripts/read_crosschain_config.js --network cchain_testnet
npx hardhat run scripts/read_crosschain_config.js --network beam_testnet
```

**Expected result:**

- PolicyServer shows allowed request sources (BEAM chain + client)
- PolicyClient shows request target (C-Chain + server))
- PolicyClient shows allowed policy sources (C-Chain + server)
- All addresses and chain IDs match

---

### 11.3. Test Cross-Chain Policy Request

```bash
npx hardhat run scripts/request_policy_crosschain.js --network beam_testnet
```

**What this should do:**

- PolicyClient sends Teleporter message to C-Chain
- PolicyServer receives request and reads from PolicyGovernor
- PolicyServer sends response back via Teleporter
- PolicyClient receives and stores policy
- **Requires:** Teleporter relayers to be running

**Expected result:**

- Request transaction succeeds
- Teleporter messageId returned
- Wait for relayer to process (~30s to few minutes)
- Policy appears in PolicyClient storage
- Can verify with `read_policy_client.js`


# 10.4: ⭐ NEW - Stake WBEAM into vault
STAKE_BEAM_AMOUNT=100 npx hardhat run scripts/stake_beam.js --network beam_testnet

# 10.5: ⭐ NEW - Verify distribution matches policy
npx hardhat run scripts/verify_policy_distribution.js --network beam_testnet

# 10.6: Read full vault state
npx hardhat run scripts/read_beam_vault_and_buckets.js --network beam_testnet

# 10.7: (Optional) Full smoke test
npx hardhat run scripts/beam_vault_smoke.js --network beam_testnet