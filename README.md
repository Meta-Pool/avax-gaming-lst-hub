# Cross-Chain Governance on Avalanche

A decentralized governance system demonstrating cross-subnet coordination using Avalanche's Interchain Messaging (ICM/Teleporter).

**Governance happens on C-Chain. Execution happens on BEAM.** Policy decisions made by DAO token holders on C-Chain control how assets are managed on the BEAM subnet.

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| **[PROOF_OF_WORK.md](PROOF_OF_WORK.md)** | Complete system overview with deployed contracts and verification commands |
| **[HOW_TO_RUN_THE_DEMO.md](HOW_TO_RUN_THE_DEMO.md)** | Step-by-step deployment and demo execution guide |
| **[VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md)** | Contract verification instructions for block explorers |
| **[SWITCH_TO_MOCK_CLIENT.md](SWITCH_TO_MOCK_CLIENT.md)** | Guide for switching between mock and real cross-chain policy clients |

---

## 🏗️ Architecture

### C-Chain (Governance Layer)
- **mpDAO Token** — ERC20 governance token with capped supply and burn mechanism
- **VotingPower** — Stake/lock mpDAO to gain voting power (time-weighted)
- **PolicyGovernor** — Epoch-based voting with quorum requirements
- **PolicyServer** — Cross-chain message handler for policy distribution

### BEAM Subnet (Execution Layer)
- **StBEAMVault** — ERC-4626 compliant liquid staking vault
- **MockPolicyClient** — Policy consumer (demo mode, no Teleporter dependency)
- **WBEAM** — Wrapped BEAM token

### Flow
1. Users vote on validator delegation weights using mpDAO voting power
2. PolicyGovernor finalizes policy each epoch (7 days)
3. BEAM vault reads policy and distributes deposits across validator buckets
4. Bucket accounting simulates how funds would be delegated to validators

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Funded wallet on Avalanche Fuji Testnet (C-Chain and BEAM)

### Installation

```bash
npm install
npx hardhat compile
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

**Required variables:**
```bash
PRIVATE_KEY=0x...
RPC_CCHAIN_TESTNET=https://api.avax-test.network/ext/bc/C/rpc
RPC_BEAM_TESTNET=https://build.onbeam.com/rpc/testnet
SNOWTRACE_API_KEY=your_api_key  # Optional but recommended
```

### Verify Network Connectivity

```bash
npm run smoke:cchain
npm run smoke:beam
```

---

## 📋 Key Commands

### Deployment (see [HOW_TO_RUN_THE_DEMO.md](HOW_TO_RUN_THE_DEMO.md))

```bash
# C-Chain deployments
npm run deploy:mpdao
npm run deploy:voting-power
npm run deploy:policy-governor

# BEAM deployments
npm run deploy:beam-vault
```

### Inspection

```bash
# Read C-Chain governance state
npm run read:cchain-policy

# Read BEAM vault and buckets
npm run read:beam-vault

# Check balances
CHECK_ADDRESS=0x... npm run check_mpdao_balance.js --network cchain_testnet
CHECK_ADDRESS=0x... npm run check_beam_balances.js --network beam_testnet
```

### Contract Verification

```bash
# Verify all C-Chain contracts
npm run verify:cchain

# Verify specific contract only (saves API calls)
VERIFY_ONLY=policyGovernor npm run verify:cchain
```

### Policy Client Management

```bash
# Switch vault to use MockPolicyClient (demo mode)
npm run vault:use-mock

# Switch to real PolicyClient (requires Teleporter)
npm run vault:use-real
```

---

## 🎯 Deployed Contracts

### C-Chain (Fuji Testnet)

| Contract | Address | Explorer |
|----------|---------|----------|
| mpDAO Token | `0x31e0752Deb99f1fCE9701Dc5611A1652189dEdC3` | [View](https://testnet.snowtrace.io/address/0x31e0752Deb99f1fCE9701Dc5611A1652189dEdC3) |
| VotingPower | `0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583` | [View](https://testnet.snowtrace.io/address/0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583) |
| PolicyGovernor | `0x19Af9A1F3f276e4F4A708Aca04E5B2Ea1520D08E` | [View](https://testnet.snowtrace.io/address/0x19Af9A1F3f276e4F4A708Aca04E5B2Ea1520D08E) |
| PolicyServer | `0x4A8C4229642215aB4F035Bc4A732cB918E74B283` | [View](https://testnet.snowtrace.io/address/0x4A8C4229642215aB4F035Bc4A732cB918E74B283) |

### BEAM Testnet

| Contract | Address | Explorer |
|----------|---------|----------|
| WBEAM | `0x244AfCd5a0bc8A4400c6702C6a2A7717945c5e70` | [View](https://subnets-test.avax.network/beam/address/0x244AfCd5a0bc8A4400c6702C6a2A7717945c5e70) |
| StBEAMVault | `0x16A289aF7727Bfc3A2c4bda7993568D8A3148c48` | [View](https://subnets-test.avax.network/beam/address/0x16A289aF7727Bfc3A2c4bda7993568D8A3148c48) |
| MockPolicyClient | `0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583` | [View](https://subnets-test.avax.network/beam/address/0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583) |

---

## 🔑 Key Features

- ✅ **ERC-20 Governance Token** with capped supply and burn mechanism
- ✅ **Time-Weighted Voting** — Lock tokens longer for more voting power
- ✅ **Epoch-Based Governance** — 7-day voting periods with quorum requirements
- ✅ **ERC-4626 Vault** — Standard compliant liquid staking on BEAM
- ✅ **Policy-Driven Distribution** — Governance decisions control asset allocation
- ✅ **Anti-Manipulation Safeguards** — Epoch timing rules prevent last-minute manipulation
- ✅ **Upgradeable Architecture** — ERC-1967 proxy pattern for future enhancements

---

## 🛠️ Development

### Compile Contracts

```bash
npx hardhat compile
```

### Run Tests

```bash
npx hardhat test
```

### Clean Build Artifacts

```bash
npm run clean
```

---

## 📄 License

MIT

---

## 🤝 Contributing

This is a hackathon proof-of-concept. For production use, additional security audits and testing are required.
