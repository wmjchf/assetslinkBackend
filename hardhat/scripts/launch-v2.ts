import { ethers } from "hardhat";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main() {
  const signer = await ethers.getSigners().then((s) => s[0]);
  if (!signer) throw new Error("No signer. Check HARDHAT_PRIVATE_KEY.");

  const TOKEN_ADDRESS = mustEnv("TOKEN_ADDRESS");
  const ROUTER = mustEnv("UNISWAP_V2_ROUTER");

  const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS || "18");
  const TOKEN_LIQUIDITY_AMOUNT = mustEnv("LIQUIDITY_TOKEN_AMOUNT"); // human units
  const ETH_LIQUIDITY_AMOUNT = mustEnv("LIQUIDITY_ETH_AMOUNT"); // ETH (human, e.g. 0.5)

  const LP_LOCK_SECONDS = BigInt(process.env.LP_LOCK_SECONDS || "31536000"); // 1 year
  const LP_BENEFICIARY = mustEnv("LP_BENEFICIARY");
  const LP_LOCK_ADDRESS = process.env.LP_LOCK_ADDRESS || "";

  const token = await ethers.getContractAt("OZAdvancedLaunchToken", TOKEN_ADDRESS);

  // Ensure router/pair
  const currentPair = await token.uniswapV2Pair();
  if (currentPair === ethers.ZeroAddress) {
    const tx = await token.setRouter(ROUTER);
    await tx.wait();
  }
  const pair = await token.uniswapV2Pair();
  if (pair === ethers.ZeroAddress) throw new Error("Pair not set. setRouter failed?");

  const router = await ethers.getContractAt(
    [
      "function addLiquidityETH(address token,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) payable returns (uint256,uint256,uint256)",
    ],
    ROUTER
  );

  const tokenAmountRaw = ethers.parseUnits(TOKEN_LIQUIDITY_AMOUNT, TOKEN_DECIMALS);
  const ethAmountWei = ethers.parseEther(ETH_LIQUIDITY_AMOUNT);

  // Approve router to spend token
  const approveTx = await token.approve(ROUTER, tokenAmountRaw);
  await approveTx.wait();

  // Add liquidity
  const deadline = Math.floor(Date.now() / 1000) + 60 * 10;
  const addTx = await router.addLiquidityETH(
    TOKEN_ADDRESS,
    tokenAmountRaw,
    0,
    0,
    signer.address,
    deadline,
    { value: ethAmountWei }
  );
  const receipt = await addTx.wait();
  console.log("Liquidity added tx:", receipt?.hash);

  // LP token is the pair address (ERC20)
  const lp = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"],
    pair
  );
  const lpBalance = await lp.balanceOf(signer.address);
  if (lpBalance === 0n) throw new Error("No LP tokens received. Check addLiquidity.");

  // Deploy or use LPTimeLock
  let lockAddress = LP_LOCK_ADDRESS;
  if (!lockAddress) {
    const Lock = await ethers.getContractFactory("LPTimeLock");
    const lock = await Lock.deploy();
    await lock.waitForDeployment();
    lockAddress = await lock.getAddress();
    console.log("Deployed LPTimeLock:", lockAddress);
  } else {
    console.log("Using LPTimeLock:", lockAddress);
  }

  const lock = await ethers.getContractAt(
    ["function createLock(address token,address beneficiary,uint256 amount,uint256 unlockTime) returns (uint256)"],
    lockAddress
  );

  // Approve lock contract to take LP tokens
  const approveLpTx = await lp.approve(lockAddress, lpBalance);
  await approveLpTx.wait();

  const now = BigInt(Math.floor(Date.now() / 1000));
  const unlockTime = now + LP_LOCK_SECONDS;
  const lockTx = await lock.createLock(pair, LP_BENEFICIARY, lpBalance, unlockTime);
  const lockReceipt = await lockTx.wait();
  console.log("LP locked tx:", lockReceipt?.hash);
  console.log("LP locked amount:", lpBalance.toString());
  console.log("LP unlockTime:", unlockTime.toString());

  // Enable trading
  const tradingTx = await token.enableTrading();
  await tradingTx.wait();
  console.log("Trading enabled at block:", await token.launchBlock());

  console.log("Done.");
  console.log("Token:", TOKEN_ADDRESS);
  console.log("Pair (LP):", pair);
  console.log("LPTimeLock:", lockAddress);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


