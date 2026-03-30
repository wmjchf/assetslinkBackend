import hre from "hardhat";

/**
 * BSC nodes return `"to": ""` for contract-creation transactions,
 * which crashes ethers v6. Use raw JSON-RPC to bypass it.
 */
async function deployRaw(
  factory: any,
  deployer: any,
  chainId: number,
  constructorArgs: any[] = []
): Promise<{ txHash: string; contractAddress: string; contract: any }> {
  const provider = (hre.ethers as any).provider;
  const deployerAddr = await deployer.getAddress();

  const deployTxReq = await factory.getDeployTransaction(...constructorArgs);

  const [nonce, gasPrice, gasEstimate] = await Promise.all([
    provider.send("eth_getTransactionCount", [deployerAddr, "latest"]),
    provider.send("eth_gasPrice", []),
    provider.send("eth_estimateGas", [{ from: deployerAddr, data: deployTxReq.data }]),
  ]);

  const tx = {
    type: 0,
    nonce:    parseInt(nonce, 16),
    gasPrice: BigInt(gasPrice),
    gasLimit: BigInt(gasEstimate) + BigInt(50000),
    chainId,
    data:     deployTxReq.data,
    value:    BigInt(0),
    to:       null,
  };

  const signedTx = await deployer.signTransaction(tx);
  const txHash: string = await provider.send("eth_sendRawTransaction", [signedTx]);
  console.log("Deploy tx sent:", txHash);

  while (true) {
    const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      if (parseInt(receipt.status, 16) === 0) throw new Error(`Deploy tx reverted: ${txHash}`);
      const contract = factory.attach(receipt.contractAddress);
      return { txHash, contractAddress: receipt.contractAddress, contract };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function main() {
  const network = hre.network;
  const isBsc = network.name === "bsc" || network.name === "bscTestnet";
  const chainId = isBsc ? (network.name === "bsc" ? 56 : 97) : undefined;
  const shouldVerify = process.env.VERIFY_CONTRACTS === "true" || process.env.VERIFY_CONTRACTS === "1";

  // Constructor args
  // LP_LOCK_FEE: fee in wei (e.g. "100000000000000" = 0.0001 BNB/ETH). Default 0 = free.
  // LP_LOCK_FEE_RECIPIENT: address that receives fees. Defaults to deployer.
  const privateKey = process.env.HARDHAT_PRIVATE_KEY;
  if (!privateKey) throw new Error("HARDHAT_PRIVATE_KEY not set");
  const deployer = new hre.ethers.Wallet(privateKey, (hre.ethers as any).provider);

  const lockFee       = BigInt(process.env.LP_LOCK_FEE || "0");
  const feeRecipient  = process.env.LP_LOCK_FEE_RECIPIENT || deployer.address;

  console.log("lockFee:      ", lockFee.toString(), "wei");
  console.log("feeRecipient: ", feeRecipient);

  // @ts-ignore
  const Factory = await hre.ethers.getContractFactory("LPTimeLock", deployer);

  const constructorArgs = [lockFee, feeRecipient] as const;
  let contractAddress: string;

  if (isBsc && chainId) {
    const result = await deployRaw(Factory, deployer, chainId, [...constructorArgs]);
    contractAddress = result.contractAddress;
  } else {
    const lock = await Factory.deploy(...constructorArgs);
    await lock.waitForDeployment();
    // @ts-ignore
    contractAddress = await lock.getAddress();
  }

  console.log("\n=== Deployment Summary ===");
  console.log("Network:    ", network.name);
  console.log("LPTimeLock: ", contractAddress);

  if (shouldVerify) {
    console.log("\nWaiting 10s before verification...");
    await new Promise((r) => setTimeout(r, 10000));
    try {
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [lockFee.toString(), feeRecipient],
      });
      console.log("✓ LPTimeLock verified");
    } catch (e: any) {
      if (e.message.includes("Already Verified")) {
        console.log("✓ Already verified");
      } else {
        console.warn("⚠ Verification failed:", e.message);
        console.log(
          `Verify manually: npx hardhat verify --network ${network.name} ${contractAddress} ${lockFee} ${feeRecipient}`
        );
      }
    }
  } else {
    console.log(`\nTo verify: npx hardhat verify --network ${network.name} ${contractAddress} ${lockFee} ${feeRecipient}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
