import hre from "hardhat";

async function main() {
  // @ts-ignore
  const signers = await hre.ethers.getSigners();
  const deployer = signers[0];
  if (!deployer) {
    throw new Error("No deployer account. Make sure HARDHAT_PRIVATE_KEY is set.");
  }

  const network = hre.network;
  const shouldVerify =
    process.env.VERIFY_CONTRACTS === "true" ||
    process.env.VERIFY_CONTRACTS === "1";

  // ── Constructor args ─────────────────────────────────────────────────────────
  const feeCollector = process.env.FEE_COLLECTOR?.trim() || deployer.address;

  console.log("Network      :", network.name);
  console.log("Deployer     :", deployer.address);
  console.log("FeeCollector :", feeCollector);

  // ── Deploy ───────────────────────────────────────────────────────────────────
  const Factory = await hre.ethers.getContractFactory("BatchTransferETH");
  // @ts-ignore
  const contract = await Factory.deploy(feeCollector);
  await contract.waitForDeployment();
  // @ts-ignore
  const contractAddress = await contract.getAddress();
  console.log("\nDeployed BatchTransferETH:", contractAddress);

  // ── Optional: setFeeConfig ───────────────────────────────────────────────────
  // BATCH_PER_ADDRESS_FEE: wei per address. ETH/Base/Arb/OP: 2e13 (0.00002 ETH), BSC: 5e13 (0.00005 BNB)
  const envPerAddressFee = process.env.BATCH_PER_ADDRESS_FEE?.trim();

  if (envPerAddressFee) {
    const paf = BigInt(envPerAddressFee);
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const c = await hre.ethers.getContractAt("BatchTransferETH", contractAddress);
        const tx = await c.setFeeConfig(paf);
        await tx.wait();
        console.log("✓ setFeeConfig   perAddressFee =", paf.toString(), "wei");
        break;
      } catch (e) {
        if (attempt === maxAttempts) throw e;
        console.warn(`  setFeeConfig attempt ${attempt} failed, retrying in 3s...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  } else {
    console.log("  setFeeConfig skipped (no BATCH_PER_ADDRESS_FEE)");
  }

  // ── Verify ─────────────────────────────────────────────────────────────────
  if (shouldVerify) {
    console.log("\nWaiting 12s for block explorer to index the contract...");
    await new Promise((resolve) => setTimeout(resolve, 12_000));

    try {
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [feeCollector],
      });
      console.log("✓ BatchTransferETH verified");
    } catch (err: any) {
      if (err.message?.includes("Already Verified")) {
        console.log("✓ Already verified");
      } else {
        console.warn("⚠ Verification failed:", err.message);
        console.log("Manual verify command:");
        console.log(
          `  npx hardhat verify --network ${network.name} ${contractAddress} "${feeCollector}"`
        );
      }
    }
  } else {
    console.log("\n⚠ Verification skipped (set VERIFY_CONTRACTS=true to enable)");
    console.log("Manual verify command:");
    console.log(
      `  npx hardhat verify --network ${network.name} ${contractAddress} "${feeCollector}"`
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n=== Deployment Summary ===");
  console.log("Network          :", network.name);
  console.log("BatchTransferETH :", contractAddress);
  console.log("FeeCollector     :", feeCollector);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
