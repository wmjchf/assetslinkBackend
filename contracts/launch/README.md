# Token Launch (Advanced) Contracts

This folder contains two Solidity contracts for an **advanced token launch** flow (Uniswap V2 style):

- `AdvancedLaunchToken.sol`: ERC20 token with optional buy/sell fees, anti-bot rules, whitelist/blacklist, limits, and auto-liquidity (swap-back).
- `LPTimeLock.sol`: A simple time-lock vault for **ERC20 LP tokens** (e.g. Uniswap V2 LP tokens).

## What this repo provides

This Next.js repo **does not include a Solidity build toolchain** (no Hardhat/Foundry setup).  
You can compile & deploy these contracts using:

- **Foundry** (recommended)
- **Hardhat**
- Any Solidity IDE / CI you prefer

## Foundry quick start (recommended)

1) Install Foundry on your machine (outside this repo).
2) Create a minimal `foundry.toml` and copy these contracts into your Foundry project.
3) Compile:

```bash
forge build
```

4) Deploy `AdvancedLaunchToken` then:
   - call `setRouter(router)` to create the pair
   - add liquidity via router
   - lock the LP token via `LPTimeLock`
   - call `enableTrading()`

## Notes / Warnings

- **Uniswap V2** LP tokens are ERC20 and can be time-locked with `LPTimeLock`.
- **Uniswap V3** LP positions are NFTs and require a different locker design.
- Anti-bot / blacklist / tax features can be abused. Use responsibly and consider audits.


