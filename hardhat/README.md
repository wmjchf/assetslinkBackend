# Hardhat (Compile & Deploy)

This repo is primarily a **Next.js** app, but it also contains Solidity contracts under `contracts/`.
To compile/deploy the launch contracts, we provide a minimal **Hardhat** setup.

## 1) Install deps

```bash
pnpm install
```

## 2) Create `.env.local` (or export env vars)

Copy from `env.example` and fill:

- `HARDHAT_RPC_URL`
- `HARDHAT_PRIVATE_KEY`

Optional token params:

- `TOKEN_NAME`
- `TOKEN_SYMBOL`
- `TOKEN_DECIMALS`
- `TOKEN_TOTAL_SUPPLY` (human units)
- `TOKEN_MARKETING_WALLET`
- `UNISWAP_V2_ROUTER` (router address on your chain)

## 3) Compile

```bash
pnpm hh:compile
```

## 4) Deploy token

```bash
pnpm hh:deploy:token
```

This deploys `contracts/launch/OZAdvancedLaunchToken.sol`.
If `UNISWAP_V2_ROUTER` is set, it will also call `setRouter()` and create the pair.

## 5) Configure fees / anti-bot / limits

Set `TOKEN_ADDRESS` in env, then:

```bash
pnpm hh:configure:token
```

## 6) Deploy LP lock

```bash
pnpm hh:deploy:lp-lock
```

## 7) One-click V2 launch (add liquidity + lock LP + enable trading)

Set these env vars:

- `TOKEN_ADDRESS`
- `UNISWAP_V2_ROUTER`
- `TOKEN_DECIMALS`
- `LIQUIDITY_TOKEN_AMOUNT` (human units)
- `LIQUIDITY_ETH_AMOUNT` (ETH, human units)
- `LP_LOCK_SECONDS`
- `LP_BENEFICIARY`
- `LP_LOCK_ADDRESS` (optional, if empty it will deploy a new `LPTimeLock`)

Then run:

```bash
pnpm hh:launch:v2
```

## Deploy V2 launch factory (for frontend one-click)

This deploys a shared on-chain factory that users can call from the frontend.

Set:
- `UNISWAP_V2_ROUTER`

Run:

```bash
pnpm hh:deploy:factory:v2
```

## Deploy TokenFactory (for frontend Create Token)

```bash
pnpm hh:deploy:token-factory
```

## Typical launch flow

1) Deploy `OZAdvancedLaunchToken`
2) `setRouter(router)` (creates pair)
3) Add liquidity via the router (external step in wallet / script)
4) Lock LP token in `LPTimeLock`
5) `enableTrading()`

## Files

- `contracts/launch/OZAdvancedLaunchToken.sol`
- `contracts/launch/LPTimeLock.sol`
- `hardhat/scripts/deploy-token.ts`
- `hardhat/scripts/configure-token.ts`
- `hardhat/scripts/deploy-lp-lock.ts`


