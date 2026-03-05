# Hardhat Multi-network Skeleton (Issue 1)

Setup base para trabajar con 3 redes:
- `cchain_testnet`
- `dfk_testnet`
- `beam_testnet`

## Setup

1. Node.js 18+.
2. Instala dependencias:

```bash
npm install
```

3. Crea `.env` desde `.env.example`:

```bash
cp .env.example .env
```

Variables requeridas:
- `RPC_CCHAIN_TESTNET`
- `RPC_DFK_TESTNET`
- `RPC_BEAM_TESTNET`
- `PRIVATE_KEY`
- `TELEPORTER_MESSENGER_CCHAIN`
- `TELEPORTER_MESSENGER_DFK`
- `TELEPORTER_MESSENGER_BEAM`

## Comandos

Compilar:

```bash
npx hardhat compile
```

Smoke test C-Chain testnet:

```bash
npx hardhat run scripts/smoke.js --network cchain_testnet
```

Smoke test DFK testnet:

```bash
npx hardhat run scripts/smoke.js --network dfk_testnet
```

Smoke test BEAM testnet:

```bash
npx hardhat run scripts/smoke.js --network beam_testnet
```

## Issue 2 - mpDAO Mock en C-Chain

Deploy en C-Chain testnet y persistencia en `deployments.json`:

```bash
npm run deploy:mpdao
```

Configurable por `.env`:

```bash
MPDAO_NAME, MPDAO_SYMBOL, MPDAO_INITIAL_SUPPLY
```

Mint a 2 cuentas:

```bash
npm run mint:mpdao
```

Requiere en `.env`:
- `MINT_ACCOUNT_1`
- `MINT_ACCOUNT_2`
- opcional `MINT_AMOUNT_1` y `MINT_AMOUNT_2` (default `1000`).

## Issue 3 - Voting Power en C-Chain (Proxy)

Deploy de `VotingPowerV1` usando patrón proxy:

```bash
npm run deploy:voting-power
```

Stake/lock para obtener VP:

```bash
npm run stake:vp
```

Requiere en `.env`:
- `STAKE_AMOUNT` (tokens enteros, default `1000`)
- `STAKE_LOCK_DAYS` (entre `30` y `300`, default `30`)
- opcional `USER_B_ADDRESS` (si falta, se usa una address aleatoria para validar VP=0)
