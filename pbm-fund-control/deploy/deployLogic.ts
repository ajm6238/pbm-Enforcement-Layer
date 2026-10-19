import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`[Deployer] ${deployer.address}`);

  console.log(`[Status] Deploying PBMLogic...`);
  const PBMLogic = await ethers.getContractFactory("PBMLogic");
  const pbmLogic = await PBMLogic.connect(deployer).deploy();
  await pbmLogic.deployed();

  console.log(`[Address] PBMLogic deployed at ${pbmLogic.address}`);
  console.log(`[Status] ✅ PBMLogic deployment completed`);
}

main().catch((err) => {
  console.error("[Status] ❌ An error occurred:", err.message);
  process.exit(1);
});
