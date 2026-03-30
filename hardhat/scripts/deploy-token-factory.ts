import hre from "hardhat";

/**
 * BSC nodes return `"to": ""` (empty string) for contract-creation transactions
 * instead of `null`, which crashes ethers v6 address validation deep inside the
 * transaction formatter.  This function bypasses all ethers transaction parsing
 * by using raw JSON-RPC calls, so the quirk never reaches the formatter.
 *
 * Steps:
 *  1. Get the unsigned deploy tx via ContractFactory.getDeployTransaction()
 *  2. Manually set nonce / gasPrice / chainId
 *  3. Sign with the deployer signer
 *  4. Broadcast via `provider.send("eth_sendRawTransaction", ...)`
 *  5. Poll the receipt via `provider.send("eth_getTransactionReceipt", ...)`
 */
async function deployRaw(
  factory: any,
  deployer: any
): Promise<{ txHash: string; contractAddress: string; contract: any }> {
  const provider = hre.ethers.provider;
  const deployerAddr = await deployer.getAddress();

  // 1. Build unsigned tx
  const deployTxReq = await factory.getDeployTransaction();

  // 2. Populate fields that BSC needs manually
  //    BSC is a legacy-fee chain (no EIP-1559), use type-0 tx
  const [nonce, gasPrice, gasEstimate] = await Promise.all([
    provider.send("eth_getTransactionCount", [deployerAddr, "latest"]),
    provider.send("eth_gasPrice", []),
    provider.send("eth_estimateGas", [{ from: deployerAddr, data: deployTxReq.data }]),
  ]);

  const tx = {
    type: 0,
    nonce:    parseInt(nonce, 16),
    gasPrice: BigInt(gasPrice),
    gasLimit: BigInt(gasEstimate) + BigInt(50000), // add buffer
    chainId:  56,
    data:     deployTxReq.data,
    value:    BigInt(0),
    to:       null,
  };

  // 3. Sign
  const signedTx = await deployer.signTransaction(tx);

  // 4. Broadcast (raw JSON-RPC — no ethers response parsing)
  const txHash: string = await provider.send("eth_sendRawTransaction", [signedTx]);
  console.log("Deploy tx sent:", txHash);

  // 5. Poll receipt (raw JSON-RPC)
  while (true) {
    const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      if (parseInt(receipt.status, 16) === 0) {
        throw new Error(`Deploy tx reverted: ${txHash}`);
      }
      const contractAddress: string = receipt.contractAddress;
      const contract = factory.attach(contractAddress);
      return { txHash, contractAddress, contract };
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
  const isBsc = network.name === "bsc";

  // Deploy TokenFactory — token + optional distribution only (vesting via VestingTimeLock)
  // @ts-ignore - Hardhat ethers helpers
  const Factory = await hre.ethers.getContractFactory("TokenFactory", deployer);

  let factory: any;
  let factoryAddress: string;

  if (isBsc) {
    // BSC quirk: use raw deployment to bypass ethers v6 "to"="" parser crash
    const result = await deployRaw(Factory, deployer);
    factory = result.contract;
    factoryAddress = result.contractAddress;
  } else {
    factory = await Factory.deploy();
    const deployTx = factory.deploymentTransaction();
    if (!deployTx?.hash) {
      await factory.waitForDeployment();
      factoryAddress = await factory.getAddress();
    } else {
      const provider = hre.ethers.provider;
      while (true) {
        const receipt = await provider.getTransactionReceipt(deployTx.hash);
        if (receipt) {
          if (receipt.status === 0) throw new Error(`Deploy tx ${deployTx.hash} reverted`);
          factoryAddress = receipt.contractAddress ?? await factory.getAddress();
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  console.log("Deployed TokenFactory:", factoryAddress);

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

      console.log("  Vesting: deploy VestingTimeLock + verify; see deploy-vesting-timelock.ts.");
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
