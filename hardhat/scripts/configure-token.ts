import { ethers } from "hardhat";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main() {
  const tokenAddress = mustEnv("TOKEN_ADDRESS");
  const token = await ethers.getContractAt("OZAdvancedLaunchToken", tokenAddress);

  const buyMarketingBps = Number(process.env.BUY_MARKETING_BPS || "200");
  const buyLiquidityBps = Number(process.env.BUY_LIQUIDITY_BPS || "200");
  const buyBurnBps = Number(process.env.BUY_BURN_BPS || "0");

  const sellMarketingBps = Number(process.env.SELL_MARKETING_BPS || "300");
  const sellLiquidityBps = Number(process.env.SELL_LIQUIDITY_BPS || "300");
  const sellBurnBps = Number(process.env.SELL_BURN_BPS || "0");

  const deadBlocks = BigInt(process.env.DEAD_BLOCKS || "3");
  const maxGasGwei = BigInt(process.env.MAX_GAS_GWEI || "0");
  const maxGasWei = maxGasGwei * BigInt(1_000_000_000);

  const maxTxRaw = BigInt(process.env.MAX_TX_RAW || "0");
  const maxWalletRaw = BigInt(process.env.MAX_WALLET_RAW || "0");
  const revertEarlyBuys = (process.env.REVERT_EARLY_BUYS || "true") !== "false";

  console.log("Configuring token:", tokenAddress);

  const tx1 = await token.setBuyFees(buyMarketingBps, buyLiquidityBps, buyBurnBps);
  await tx1.wait();
  console.log("Buy fees set.");

  const tx2 = await token.setSellFees(sellMarketingBps, sellLiquidityBps, sellBurnBps);
  await tx2.wait();
  console.log("Sell fees set.");

  const tx3 = await token.setLimits(maxGasWei, deadBlocks, revertEarlyBuys, maxTxRaw, maxWalletRaw);
  await tx3.wait();
  console.log("Limits set.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


