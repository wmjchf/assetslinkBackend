import { ethers } from "hardhat";

async function main() {
  const Lock = await ethers.getContractFactory("LPTimeLock");
  const lock = await Lock.deploy();
  await lock.waitForDeployment();
  console.log("Deployed LPTimeLock:", await lock.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


