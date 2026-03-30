import hre from "hardhat";

/**
 * Owner-only: set perAddressFee on an already-deployed BatchTransferETH.
 * Env: BATCH_TRANSFER_ADDRESS, BATCH_PER_ADDRESS_FEE (wei string)
 */
async function main() {
  const address = process.env.BATCH_TRANSFER_ADDRESS?.trim();
  const feeStr = process.env.BATCH_PER_ADDRESS_FEE?.trim();
  if (!address) throw new Error("Set BATCH_TRANSFER_ADDRESS");
  if (!feeStr) throw new Error("Set BATCH_PER_ADDRESS_FEE (wei)");

  const fee = BigInt(feeStr);
  const c = await hre.ethers.getContractAt("BatchTransferETH", address);
  const tx = await c.setFeeConfig(fee);
  await tx.wait();
  console.log("setFeeConfig ok  perAddressFee =", fee.toString(), "wei");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
