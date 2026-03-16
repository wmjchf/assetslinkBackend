import { ethers } from "hardhat";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main() {
  const router = mustEnv("UNISWAP_V2_ROUTER");
  const tokenImpl = mustEnv("TOKEN_IMPL_ADDRESS");

  const Factory = await ethers.getContractFactory("V2LaunchFactory");
  const factory = await Factory.deploy(router, tokenImpl);
  await factory.waitForDeployment();

  console.log("Deployed V2LaunchFactory:", await factory.getAddress());
  console.log("Router:", router);
  console.log("Token implementation:", tokenImpl);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


