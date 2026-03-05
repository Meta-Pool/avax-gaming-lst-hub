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

## Issue 5 - Policy Timing (epoch-1 rule)

Regla de timing anti-manipulacion:

- `currentEpoch` se calcula igual en C-Chain y BEAM con:
  - `currentEpoch = floor((timestamp - START_TIMESTAMP) / EPOCH_SECONDS) + 1`
- Para aplicar policy en BEAM:
  - `epochToUse = currentEpoch - 1`

En `PolicyGovernor`:
- `currentEpoch(timestamp)` devuelve epoch para un timestamp dado.
- `applicableEpoch(timestamp)` devuelve `currentEpoch(timestamp) - 1`.
- `getApplicableEpoch()` aplica esa regla usando `block.timestamp`.

Ejemplos (si `EPOCH_SECONDS = 60`):

- `t = START + 0s` -> `currentEpoch = 1`, `epochToUse = 0`
- `t = START + 59s` -> `currentEpoch = 1`, `epochToUse = 0`
- `t = START + 60s` -> `currentEpoch = 2`, `epochToUse = 1`
- `t = START + 120s` -> `currentEpoch = 3`, `epochToUse = 2`

Script de verificacion:

```bash
npm run verify:policy-timing
```

## Issue 6 - BEAM Vault ERC4626 stBEAM + deposit fee

Contratos:
- `StBEAMVault` (ERC4626) para mintear `stBEAM`.
- `BeamAssetMock` (si no se provee asset externo).

Modelo de fee:
- `DEPOSIT_FEE_BPS` se cobra **sobre el monto depositado**.
- No es un cargo adicional.
- El fee acumulado queda en `feeAccumulator`.

Deploy en BEAM testnet:

```bash
npm run deploy:beam-vault
```

Smoke de vault (deposit + withdraw + fee):

```bash
npm run smoke:beam-vault
```

Eventos:
- `Deposit` (ERC4626 estándar)
- `Withdraw` (ERC4626 estándar)
- `FeeCharged` (custom)

## Issue 7 - BEAM PolicyClient (request/response + fallback)

`PolicyClient` en BEAM:
- `requestPolicy(epoch)` envia solicitud a C-Chain.
- `onPolicyResponse(...)` / `onTeleporterMessage(...)` reciben y guardan policy.
- Storage:
  - `lastKnownEpoch`
  - `lastKnownPolicy` (validator IDs + weights BPS)
- `getPolicyOrFallback(epoch)`:
  - si existe policy para `epoch`, la devuelve.
  - si no existe, devuelve `lastKnownPolicy` y emite `PolicyFallbackUsed`.

Eventos:
- `PolicyRequested`
- `PolicyReceived`
- `PolicyFallbackUsed`

Flujo esperado (DoD):
1. Para un `epochToUse` sin policy local, se llama `requestPolicy(epochToUse)`.
2. Mientras llega respuesta, `getPolicyOrFallback(epochToUse)` usa fallback (`lastKnownPolicy`) y emite `PolicyFallbackUsed`.

### Message Format v1

Payload ABI-encoded con discriminador `messageType`:

- `RequestPolicy` (`messageType = 1`)
  - `(uint8 messageType, uint256 epoch, address requester, address vaultAddress)`
- `PolicyResponse` (`messageType = 2`)
  - `(uint8 messageType, uint256 epoch, uint256[] validatorIds, uint16[] weightsBps)`

Reglas de seguridad:
- handlers solo aceptan llamadas del `teleporterMessenger` (`onlyTeleporterMessenger`).
- ambos lados validan allowlist de `(sourceChainId, sourceSender)`.

Configuracion de peers (setters):

```bash
npm run set:policy-server-peers
npm run set:policy-client-peers
```

## Issue 9 - BEAM simulated execution (buckets)

`StBEAMVault` ahora aplica policy y simula ejecucion por buckets internos:
- Para cada deposito neto (despues de fee), distribuye por `validatorId` segun `weightsBps`.
- Contabilidad:
  - `bucket[validatorId] += amountPart`
- Eventos:
  - `PolicyApplied(epoch, weights[])`
  - `BucketsUpdated(epoch, amounts[])`

Regla aplicada:
- El vault usa `epochToUse = currentEpoch - 1`.
- Obtiene policy via `PolicyClient.getPolicyOrFallback(epochToUse)`.
- Si no hay policy para `epochToUse`, usa fallback (si existe `lastKnownPolicy`).

Lectura de estado:
- `getBuckets()` devuelve `(validatorIds[], amounts[])`.

DoD esperado:
- Tras `deposit()`, los buckets cambian y la suma de incrementos coincide con el neto depositado (monto - fee).

## Issue 10 - Demo happy path E2E

Script unico:

```bash
npm run demo:happy-path
```

Flujo del demo:
1. C-Chain: deploy `mpDAO`, `VotingPower` (proxy), `PolicyGovernor`, `PolicyServer`.
2. C-Chain: mintea mpDAO al usuario.
3. C-Chain: stake/lock para obtener VP.
4. C-Chain: vota policy A/B/C/D y finaliza epoch.
5. BEAM: deploy `PolicyClient`, `stBEAMVault`, mock asset.
6. BEAM: hace `requestPolicy(epochToUse)`.
7. Relay simulado request/response con `MockTeleporterMessenger`.
8. BEAM: deposita en vault.
9. BEAM: verifica `PolicyApplied` y `BucketsUpdated`.

Salida esperada:
- `epoch usado`
- `policy final`
- `buckets resultantes`
- `SUCCESS`
