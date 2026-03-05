# Phase 1 - Avalanche Cross-Chain Messaging PoC

PoC minima de mensajeria cross-chain entre 3 redes EVM usando Hardhat:
- C-Chain
- DFK L1
- BEAM L1

Alcance de esta fase:
- `ping/pong backbone` (envio y recepcion de mensajes)
- despliegue de `PingSender` y `PingReceiver` en las 3 redes
- scripts de deploy, envio y lectura de estado

Fuera de alcance:
- ERC-4626
- staking/yield
- deploy remoto de contratos (Fase 2+)

## Estructura

```text
contracts/
  interfaces/ITeleporterMessenger.sol
  PingSender.sol
  PingReceiver.sol
scripts/
  lib/config.js
  deploy-all.js
  send-ping.js
  send-triangle.js
  read-state.js
hardhat.config.js
.env.example
```

## Setup

1. Usa Node.js 18+ (Hardhat moderno no funciona en Node 14).

2. Instala dependencias:
```bash
npm install
```

3. Crea `.env` desde `.env.example` y completa:
- `RPC_CCHAIN`
- `RPC_DFK`
- `RPC_BEAM`
- `PRIVATE_KEY`
- `TELEPORTER_MESSENGER_CCHAIN`
- `TELEPORTER_MESSENGER_DFK`
- `TELEPORTER_MESSENGER_BEAM`

4. Compila:
```bash
npx hardhat compile
```

## Deploy

Despliega en las 3 redes y guarda direcciones en `deployments.json`:

```bash
npm run deploy:all
```

Opcional: escribir en otro archivo:

```bash
npm run deploy:all -- --out ./my-deployments.json
```

## Envio de ping

DFK -> C-Chain:

```bash
npm run send:ping -- --from dfk --to cchain --payload "ping from dfk"
```

BEAM -> C-Chain:

```bash
npm run send:ping -- --from beam --to cchain --payload "ping from beam"
```

Flags utiles:
- `--timeout 120` (segundos de espera por recepcion)
- `--poll 5` (intervalo de polling)
- `--strict` (falla si no detecta recepcion en destino)

## Flujo triangular

Ruta por defecto: `dfk,cchain,beam`

```bash
npm run send:triangle
```

Ruta inversa ejemplo:

```bash
npm run send:triangle -- --path beam,cchain,dfk
```

## Lectura de estado

Todas las redes:

```bash
npm run read:state
```

Solo una red:

```bash
npm run read:state -- --network cchain
```

## Criterios de exito (Fase 1)

- Los contratos compilan con Hardhat.
- `deploy-all` despliega sender/receiver en C-Chain, DFK y BEAM.
- `send-ping` emite `PingSent` en origen y detecta incremento de `totalReceived` en destino cuando el stack de mensajeria/relayer esta activo.
- `read-state` muestra contadores y ultima huella (`lastPayloadHash`) por red.
- `send-triangle` ejecuta dos saltos consecutivos usando el mismo backbone.


# Fase 2

Historia del demo (end-to-end)

Este MVP demuestra gobernanza cross-chain en Avalanche usando Teleporter/ICM:

Stake de gobernanza en C-Chain

El usuario adquiere mpDAO (token de gobernanza en C-Chain).

El usuario stakea/lockea mpDAO en un contrato de Voting Power (VP).

Resultado: el usuario obtiene poder de voto (VP) proporcional a su stake/lock.

Votación de política de delegación en C-Chain

Con su VP, el usuario vota una política de delegación (weights) para un conjunto de validadores:

Ejemplo: A=60%, B=30%, C=9%, D=1% (en basis points).

La política se calcula y publica en C-Chain con reglas de:

Epoch (se recalcula cada N minutos)

Quórum mínimo

Anti-manipulación (ver sección de diseño)

Depósito en BEAM activa consulta cross-chain

En BEAM existe un Vault (ERC-4626) donde usuarios depositan BEAM y reciben stBEAM.

Cada depósito (o cada “acción de inversión”) dispara una solicitud a C-Chain:

“¿Cuál es la política de delegación vigente para este epoch?”

C-Chain responde la política; BEAM la aplica

C-Chain responde a BEAM con la política vigente.

BEAM la registra y emite un evento:

PolicyApplied(A=6000,B=3000,C=900,D=100) (bps)

Ejecución simulada en BEAM (sin delegación real)

Para el MVP, BEAM no delega a validadores reales.

En su lugar, BEAM simula la ejecución:

divide el monto depositado en “buckets” internos por validador

registra contabilidad por validador (ej. bucket[A] += amount * 6000/10000)

Esto demuestra que la política de C-Chain impacta directamente cómo se “dirigiría” el stake en BEAM.

(Opcional) Movilidad cross-chain de stBEAM

El usuario puede transferir stBEAM entre BEAM ↔ C-Chain (ICTT).

Esto prueba interoperabilidad de tokens además de mensajería.

Resultado

Una demo redonda y defendible:
la gobernanza en C-Chain determina la política, y BEAM la consume y ejecuta, todo vía Teleporter/ICM, con un modelo de epoch/quórum/fees para hacerlo robusto.