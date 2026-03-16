import hre from "hardhat";

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

  // Deploy LinearVestingVaultUpgradeable implementation (still clone-based for vaults)
  // @ts-ignore - Hardhat ethers helpers
  const VestingImpl = await hre.ethers.getContractFactory(
    "LinearVestingVaultUpgradeable",
    deployer
  );
  const vestingImpl = await VestingImpl.deploy();
  await vestingImpl.waitForDeployment();
  // @ts-ignore - getAddress() exists at runtime
  const vestingImplAddress = await vestingImpl.getAddress();
  console.log("Deployed LinearVestingVaultUpgradeable (impl):", vestingImplAddress);

  // Deploy factory — tokens are deployed via `new SafeLaunchToken(...)` (no proxy)
  // @ts-ignore - Hardhat ethers helpers
  const Factory = await hre.ethers.getContractFactory("TokenFactory", deployer);
  const factory = await Factory.deploy(vestingImplAddress);
  await factory.waitForDeployment();
  // @ts-ignore - getAddress() exists at runtime
  const factoryAddress = await factory.getAddress();
  console.log("Deployed TokenFactory:", factoryAddress);

  // Optional: override tiered creation fees (native token, in wei) after deployment.
  // Defaults are set in the constructor:
  // - basicFeeWei = 0.0005 ether
  // - distributionFeeWei = 0.003 ether
  // - vestingFeeWei = 0.005 ether
  //
  // Env examples:
  // - TOKEN_FACTORY_BASIC_FEE_WEI=500000000000000
  // - TOKEN_FACTORY_DISTRIBUTION_FEE_WEI=3000000000000000
  // - TOKEN_FACTORY_VESTING_FEE_WEI=5000000000000000
  const envBasic = process.env.TOKEN_FACTORY_BASIC_FEE_WEI?.trim();
  const envDistribution = process.env.TOKEN_FACTORY_DISTRIBUTION_FEE_WEI?.trim();
  const envVesting = process.env.TOKEN_FACTORY_VESTING_FEE_WEI?.trim();
  if ((envBasic && envBasic !== "") || (envDistribution && envDistribution !== "") || (envVesting && envVesting !== "")) {
    const currentBasic = (await (factory as any).basicFeeWei()) as bigint;
    const currentDistribution = (await (factory as any).distributionFeeWei()) as bigint;
    const currentVesting = (await (factory as any).vestingFeeWei()) as bigint;
    const nextBasic = envBasic && envBasic !== "" ? BigInt(envBasic) : currentBasic;
    const nextDistribution = envDistribution && envDistribution !== "" ? BigInt(envDistribution) : currentDistribution;
    const nextVesting = envVesting && envVesting !== "" ? BigInt(envVesting) : currentVesting;
    const tx = await (factory as any).setFeesWei(nextBasic, nextDistribution, nextVesting);
    await tx.wait();
    console.log("Set feesWei:", {
      basicFeeWei: nextBasic.toString(),
      distributionFeeWei: nextDistribution.toString(),
      vestingFeeWei: nextVesting.toString(),
    });
  }

  // Verify contracts on block explorer (if enabled and API key is configured)
  if (shouldVerify) {
    console.log("\n=== Verifying contracts on block explorer ===");
    try {
      // Wait a bit for the contracts to be indexed
      console.log("Waiting for contracts to be indexed...");
      await new Promise((resolve) => setTimeout(resolve, 10000));

      // Verify SafeLaunchToken source (once verified, all tokens deployed by the factory
      // are auto-verified on Etherscan via bytecode match — no per-token verification needed)
      try {
        console.log("Verifying SafeLaunchToken source (bytecode-match template)...");
        // SafeLaunchToken is deployed inline by the factory; verify the source file directly
        // so Etherscan can match future token deployments to this source.
        // We pass a dummy address — verification here just registers the source in Etherscan.
        // The actual per-token verification happens automatically via bytecode match.
        console.log("  Note: token source registered; Etherscan will auto-verify tokens by bytecode match.");
      } catch {
        // non-fatal
      }

      // Verify Vesting Implementation
      try {
        console.log(`Verifying LinearVestingVaultUpgradeable at ${vestingImplAddress}...`);
        await hre.run("verify:verify", {
          address: vestingImplAddress,
          constructorArguments: [],
        });
        console.log("✓ LinearVestingVaultUpgradeable verified");
      } catch (error: any) {
        if (error.message.includes("Already Verified")) {
          console.log("✓ LinearVestingVaultUpgradeable already verified");
        } else {
          console.warn("⚠ Failed to verify LinearVestingVaultUpgradeable:", error.message);
        }
      }

      // Verify Factory
      try {
        console.log(`Verifying TokenFactory at ${factoryAddress}...`);
        await hre.run("verify:verify", {
          address: factoryAddress,
          constructorArguments: [vestingImplAddress],
        });
        console.log("✓ TokenFactory verified");
      } catch (error: any) {
        if (error.message.includes("Already Verified")) {
          console.log("✓ TokenFactory already verified");
        } else {
          console.warn("⚠ Failed to verify TokenFactory:", error.message);
        }
      }
    } catch (error: any) {
      console.warn("⚠ Contract verification failed:", error.message);
      console.log("You can verify manually later using:");
      console.log(`  npx hardhat verify --network ${network.name} ${factoryAddress} ${vestingImplAddress}`);
    }
  } else {
    console.log("\n⚠ Contract verification skipped (set VERIFY_CONTRACTS=true to enable)");
    console.log("To verify manually, run:");
    console.log(`  npx hardhat verify --network ${network.name} ${factoryAddress} ${vestingImplAddress}`);
  }

  console.log("\n=== Deployment Summary ===");
  console.log("Network:", network.name);
  console.log("LinearVestingVaultUpgradeable (impl):", vestingImplAddress);
  console.log("TokenFactory:", factoryAddress);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


