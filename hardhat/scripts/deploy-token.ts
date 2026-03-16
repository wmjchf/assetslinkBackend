import { ethers } from "hardhat";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main() {
  const owner = await ethers.getSigners().then((s) => s[0]);
  if (!owner) throw new Error("No signer. Check HARDHAT_PRIVATE_KEY.");

  const TOKEN_NAME = mustEnv("TOKEN_NAME");
  const TOKEN_SYMBOL = mustEnv("TOKEN_SYMBOL");
  const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS || "18");
  const TOTAL_SUPPLY = mustEnv("TOKEN_TOTAL_SUPPLY"); // human units
  const MARKETING_WALLET = mustEnv("TOKEN_MARKETING_WALLET");

  const Router = process.env.UNISWAP_V2_ROUTER || "";

  // OZ token uses ERC20 decimals=18 by default at UI-level. For other decimals, you must scale supply accordingly.
  // Here we scale using TOKEN_DECIMALS.
  const supplyRaw = ethers.parseUnits(TOTAL_SUPPLY, TOKEN_DECIMALS);

  const Token = await ethers.getContractFactory("OZAdvancedLaunchToken");
  const token = await Token.deploy(
    owner.address,
    TOKEN_NAME,
    TOKEN_SYMBOL,
    supplyRaw,
    MARKETING_WALLET
  );
  await token.waitForDeployment();

  console.log("Deployed OZAdvancedLaunchToken:");
  console.log("- address:", await token.getAddress());
  console.log("- owner:", owner.address);

  if (Router) {
    const tx = await token.setRouter(Router);
    await tx.wait();
    console.log("Router set:", Router);
    console.log("Pair:", await token.uniswapV2Pair());
  } else {
    console.log("UNISWAP_V2_ROUTER not set, skip setRouter().");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


