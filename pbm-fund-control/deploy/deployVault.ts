import { ethers } from "hardhat";

const MOCK_USDC_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`[Deployer] ${deployer.address}`);

  console.log(`[Status] Deploying PBMVault...`);
  const PBMVault = await ethers.getContractFactory("contracts/PBMVault.sol:PBMVault");
  const pbmVault = await PBMVault.connect(deployer).deploy(MOCK_USDC_ADDRESS);
  await pbmVault.deployed();

  console.log(`[Address] PBMVault deployed at ${pbmVault.address}`);
  console.log(`[Info] Asset (MockUSDC): ${MOCK_USDC_ADDRESS}`);
  console.log(`[Status] ✅ PBMVault deployment completed`);
}

main().catch((err) => {
  console.error("[Status] ❌ An error occurred:", err.message);
  process.exit(1);
});
