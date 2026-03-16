import hre from "hardhat";

async function main() {
  const tokenImplAddress = process.env.TOKEN_IMPL_ADDRESS;
  const vestingImplAddress = process.env.VESTING_IMPL_ADDRESS;
  const factoryAddress = process.env.TOKEN_FACTORY_ADDRESS;

  if (!tokenImplAddress || !vestingImplAddress || !factoryAddress) {
    throw new Error(
      "Missing required addresses. Set TOKEN_IMPL_ADDRESS, VESTING_IMPL_ADDRESS, and TOKEN_FACTORY_ADDRESS environment variables."
    );
  }

  const network = await hre.network;
  console.log(`Verifying contracts on ${network.name}...\n`);

  // Verify Token Implementation
  try {
    console.log(`Verifying OZAdvancedLaunchTokenUpgradeable at ${tokenImplAddress}...`);
    await hre.run("verify:verify", {
      address: tokenImplAddress,
      constructorArguments: [],
    });
    console.log("✓ OZAdvancedLaunchTokenUpgradeable verified\n");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✓ OZAdvancedLaunchTokenUpgradeable already verified\n");
    } else {
      console.error("✗ Failed to verify OZAdvancedLaunchTokenUpgradeable:", error.message, "\n");
    }
  }

  // Verify Vesting Implementation
  try {
    console.log(`Verifying LinearVestingVaultUpgradeable at ${vestingImplAddress}...`);
    await hre.run("verify:verify", {
      address: vestingImplAddress,
      constructorArguments: [],
    });
    console.log("✓ LinearVestingVaultUpgradeable verified\n");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✓ LinearVestingVaultUpgradeable already verified\n");
    } else {
      console.error("✗ Failed to verify LinearVestingVaultUpgradeable:", error.message, "\n");
    }
  }

  // Verify Factory
  try {
    console.log(`Verifying TokenFactory at ${factoryAddress}...`);
    await hre.run("verify:verify", {
      address: factoryAddress,
      constructorArguments: [tokenImplAddress, vestingImplAddress],
    });
    console.log("✓ TokenFactory verified\n");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✓ TokenFactory already verified\n");
    } else {
      console.error("✗ Failed to verify TokenFactory:", error.message, "\n");
    }
  }

  console.log("Verification complete!");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

