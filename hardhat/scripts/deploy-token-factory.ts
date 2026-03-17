import hre from "hardhat";

/**
 * BSC nodes return `"to": ""` (empty string) for contract-creation transactions
 * instead of `null`, which causes ethers v6 `waitForDeployment()` to crash.
 * This helper polls `getTransactionReceipt()` directly, which correctly returns
 * `to: null` and avoids the issue.
 */
async function waitForDeploy(contract: any): Promise<string> {
  const deployTx = contract.deploymentTransaction();
  if (!deployTx?.hash) {
    await contract.waitForDeployment();
    return await contract.getAddress();
  }
  const provider = hre.ethers.provider;
  while (true) {
    const receipt = await provider.getTransactionReceipt(deployTx.hash);
    if (receipt) {
      if (receipt.status === 0) throw new Error(`Deployment tx ${deployTx.hash} reverted`);
      if (receipt.contractAddress) return receipt.contractAddress;
      return await contract.getAddress();
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function main() {
  // @ts-ignore - Hardhat ethers helpers
  const signers = await hre.ethers.getSigners();
  const deployer = signers[0];
  if (!deployer) {
    throw new Error(
      "No deployer account available. Make sure HARDHAT_PRIVATE_KEY is set for this network."
    );
  }

  const network = hre.network;
  const shouldVerify = process.env.VERIFY_CONTRACTS === "true" || process.env.VERIFY_CONTRACTS === "1";

  // Deploy TokenFactory — vesting vaults deployed via `new LinearVestingVault(...)` (no proxy)
  // @ts-ignore - Hardhat ethers helpers
  const Factory = await hre.ethers.getContractFactory("TokenFactory", deployer);
  const factory = await Factory.deploy();
  const factoryAddress = await waitForDeploy(factory);
  console.log("Deployed TokenFactory:", factoryAddress);

  // Optional: override tiered creation fees (native token, in wei) after deployment.
  // Defaults set in constructor:
  //   basicFeeWei        = 0.0001 ether
  //   distributionFeeWei = 0.001 ether
  //   vestingFeeWei      = 0.005 ether
  //
  // Env examples:
  //   TOKEN_FACTORY_BASIC_FEE_WEI=100000000000000
  //   TOKEN_FACTORY_DISTRIBUTION_FEE_WEI=1000000000000000
  //   TOKEN_FACTORY_VESTING_FEE_WEI=5000000000000000
  const envBasic        = process.env.TOKEN_FACTORY_BASIC_FEE_WEI?.trim();
  const envDistribution = process.env.TOKEN_FACTORY_DISTRIBUTION_FEE_WEI?.trim();
  const envVesting      = process.env.TOKEN_FACTORY_VESTING_FEE_WEI?.trim();
  if (envBasic || envDistribution || envVesting) {
    const currentBasic        = (await (factory as any).basicFeeWei()) as bigint;
    const currentDistribution = (await (factory as any).distributionFeeWei()) as bigint;
    const currentVesting      = (await (factory as any).vestingFeeWei()) as bigint;
    const nextBasic        = envBasic        ? BigInt(envBasic)        : currentBasic;
    const nextDistribution = envDistribution ? BigInt(envDistribution) : currentDistribution;
    const nextVesting      = envVesting      ? BigInt(envVesting)      : currentVesting;
    const tx = await (factory as any).setFeesWei(nextBasic, nextDistribution, nextVesting);
    await tx.wait();
    console.log("Set feesWei:", {
      basicFeeWei:        nextBasic.toString(),
      distributionFeeWei: nextDistribution.toString(),
      vestingFeeWei:      nextVesting.toString(),
    });
  }

  // Verify contracts on block explorer (if enabled and API key is configured)
  if (shouldVerify) {
    console.log("\n=== Verifying contracts on block explorer ===");
    try {
      console.log("Waiting 10s for contracts to be indexed...");
      await new Promise((resolve) => setTimeout(resolve, 10000));

      // Verify TokenFactory
      try {
        console.log(`Verifying TokenFactory at ${factoryAddress}...`);
        await hre.run("verify:verify", {
          address: factoryAddress,
          constructorArguments: [],
        });
        console.log("✓ TokenFactory verified");
      } catch (error: any) {
        if (error.message.includes("Already Verified")) {
          console.log("✓ TokenFactory already verified");
        } else {
          console.warn("⚠ Failed to verify TokenFactory:", error.message);
        }
      }

      // Verify LinearVestingVault source (once verified, all vault instances deployed by the
      // factory are auto-matched on Etherscan via bytecode match)
      try {
        console.log("Verifying LinearVestingVault source (bytecode-match template)...");
        // LinearVestingVault is deployed inline by the factory; use its actual address from
        // a real vault deployment or simply register the source here with a dummy call.
        console.log("  Note: deploy a token with vesting first, then verify the vault address.");
      } catch {
        // non-fatal
      }
    } catch (error: any) {
      console.warn("⚠ Contract verification failed:", error.message);
      console.log("You can verify manually later using:");
      console.log(`  npx hardhat verify --network ${network.name} ${factoryAddress}`);
    }
  } else {
    console.log("\n⚠ Contract verification skipped (set VERIFY_CONTRACTS=true to enable)");
    console.log("To verify manually, run:");
    console.log(`  npx hardhat verify --network ${network.name} ${factoryAddress}`);
  }

  console.log("\n=== Deployment Summary ===");
  console.log("Network:", network.name);
  console.log("TokenFactory:", factoryAddress);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
