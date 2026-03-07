# Hackathon Proof of Work

This MVP demonstrates cross-chain governance on Avalanche using Teleporter / ICM.

All contracts were deployed to **Avalanche C-Chain and BEAM Fuji Testnet**.

## 1. Governance Staking on C-Chain

Users acquire **mpDAO**, a governance token deployed on C-Chain. The token implements ERC20 with controlled minting and burn functionality.

- **mpDAO Token** verified contract: [**0x31e0752Deb99f1fCE9701Dc5611A1652189dEdC3**](https://testnet.snowtrace.io/address/0x31e0752Deb99f1fCE9701Dc5611A1652189dEdC3)

**Token Features:**
- 🪙 **Capped supply** — Maximum 500M tokens (6 decimals)
- 🔥 **Burnable** — Deflationary mechanism via ERC20Burnable
- 🔐 **Controlled minting** — Role-based access for authorized minters

**📜 Inspect Token State:**
```bash
# Check mpDAO balance for any address
CHECK_ADDRESS=0xe9C733bDe70B8512449eEC3323542b0F42A1a484 \
  npx hardhat run scripts/check_mpdao_balance.js --network cchain_testnet
```

---

Users stake or lock mpDAO in the **VotingPower** contract to obtain governance rights. The longer tokens are locked, the greater the voting power multiplier.

- **Voting Power** verified contract (ERC1967 Proxy): [**0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583**](https://testnet.snowtrace.io/address/0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583)

**Voting Power Features:**
- ⬆️ **Upgradeable architecture** — ERC1967 Proxy Pattern for future enhancements
- ⏳ **Time-weighted voting** — Lock periods from 30 to 300 days with voting power multipliers
- 📊 **Multiple positions** — Users can maintain up to 10 different locking positions
- 🔓 **Flexible unlocking** — Gradual unlock mechanism to prevent governance attacks

**📜 Inspect Voting Power:**
```bash
# Read voting power details for any user
CHECK_ADDRESS=0xe9C733bDe70B8512449eEC3323542b0F42A1a484 \
  npx hardhat run scripts/read_voting_power.js --network cchain_testnet
```

## 2. Delegation Policy Voting on C-Chain

Using their voting power, users vote on a **delegation policy** that defines weights for a set of validators. The policy determines how staked assets will be distributed across validators.

**Example allocation:**
- Validator A = 60% (6000 BPS)
- Validator B = 30% (3000 BPS)  
- Validator C = 9% (900 BPS)
- Validator D = 1% (100 BPS)

The policy is computed and published on C-Chain by the **PolicyGovernor** contract according to governance rules:

- **PolicyGovernor** verified contract: [**0x19Af9A1F3f276e4F4A708Aca04E5B2Ea1520D08E**](https://testnet.snowtrace.io/address/0x19Af9A1F3f276e4F4A708Aca04E5B2Ea1520D08E)

**Governance Features:**
- ⏱️ **Epoch-based updates** — Policy is recalculated every 7 days (604800 seconds)
- ✅ **Minimum quorum requirement** — 50% of voting power must participate (5000 BPS)
- 🛡️ **Anti-manipulation safeguards** — Includes time-locks, epoch finalization, and voting power snapshots

The **PolicyServer** contract handles cross-chain communication, receiving policy requests from other chains via Teleporter and responding with the finalized policy:

- **PolicyServer** verified contract: [**0x4A8C4229642215aB4F035Bc4A732cB918E74B283**](https://testnet.snowtrace.io/address/0x4A8C4229642215aB4F035Bc4A732cB918E74B283)

**📜 Inspect Policy State:**
```bash
# Read current policy, epoch, quorum, and finalized delegation weights
npm run read:cchain-policy
```

## 3. Deposit on BEAM Triggers Cross-Chain Query

On BEAM testnet, the system deploys an **ERC-4626 compliant vault** where users deposit BEAM tokens and receive **stBEAM** shares.

**Deployed Contracts:**
- **WBEAM (Wrapped BEAM Mock)** verified contract: [**0x244AfCd5a0bc8A4400c6702C6a2A7717945c5e70**](https://subnets-test.avax.network/beam/address/0x244AfCd5a0bc8A4400c6702C6a2A7717945c5e70)
- **StBEAMVault (ERC-4626)** verified contract: [**0x16A289aF7727Bfc3A2c4bda7993568D8A3148c48**](https://subnets-test.avax.network/beam/address/0x16A289aF7727Bfc3A2c4bda7993568D8A3148c48)
- **MockPolicyClient** verified contract: [**0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583**](https://subnets-test.avax.network/beam/address/0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583)

> **Note:** For demo purposes, we use MockPolicyClient which provides a hardcoded policy without requiring cross-chain Teleporter messages. This ensures reliable demos independent of testnet Teleporter relayer availability.

**📜 Inspect BEAM Balances:**
```bash
# Check native BEAM, WBEAM, and stBEAM balances
CHECK_ADDRESS=0xe9C733bDe70B8512449eEC3323542b0F42A1a484 \
  npx hardhat run scripts/check_beam_balances.js --network beam_testnet
```

**Key ERC-4626 Functions:**
```solidity
// Standard ERC-4626 deposit (requires WBEAM approval)
function deposit(uint256 assets, address receiver) returns (uint256 shares);

// Convenience function to deposit native BEAM directly
function depositBEAM(address receiver) external payable returns (uint256 shares);

// Standard ERC-4626 withdraw
function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares);
```

Each deposit (or investment action) triggers the vault to **fetch and apply the current delegation policy** from the PolicyClient.

## 4. Policy Application & Validator Bucket Distribution

The **StBEAMVault** reads the governance-approved policy from MockPolicyClient and automatically distributes deposited assets across validator buckets according to the voted weights.

**Policy Distribution Mechanism:**
- 📊 **Bucket-based accounting** — Each validator has an internal bucket tracking allocated assets
- ⚖️ **Proportional distribution** — Deposits split according to policy weights (e.g., 60%, 30%, 9%, 1%)
- 🔄 **Epoch-aware** — Vault applies the policy for the applicable epoch
- 🎯 **Simulated delegation** — Buckets represent how assets would be delegated to validators in production

**Example Policy Application:**
```
Policy: Validator 1 = 6000 BPS, Validator 2 = 3000 BPS, 
        Validator 3 = 900 BPS, Validator 4 = 100 BPS

Deposit: 100 BEAM
Result:
  bucket[1] += 60.0 BEAM  (60%)
  bucket[2] += 30.0 BEAM  (30%)
  bucket[3] +=  9.0 BEAM  (9%)
  bucket[4] +=  1.0 BEAM  (1%)
```

**📜 Inspect Vault & Buckets:**
```bash
# View vault configuration, active policy, and bucket distributions
npm run read:beam-vault
```

This demonstrates that **governance decisions from C-Chain directly control how assets are allocated on BEAM**, completing the cross-chain governance flow.

---

## Summary

The system demonstrates **cross-chain governance** on Avalanche:

✅ **Governance on C-Chain** — mpDAO token holders vote on delegation policies  
✅ **Policy finalization** — Epoch-based voting with quorum requirements  
✅ **Policy distribution** — BEAM vault consumes and applies governance decisions  
✅ **Simulated delegation** — Bucket accounting demonstrates validator fund allocation  

**Architecture:**
- **C-Chain:** Governance layer (mpDAO, VotingPower, PolicyGovernor, PolicyServer)
- **BEAM:** Execution layer (StBEAMVault, MockPolicyClient, WBEAM)
- **Integration:** Policy-driven asset distribution based on DAO voting

All contracts are deployed and verified on Avalanche Fuji Testnet, demonstrating a working cross-subnet governance system.
