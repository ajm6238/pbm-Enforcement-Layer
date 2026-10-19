import { ethers } from "hardhat";

const PAYER_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const INITIAL_SUPPLY = ethers.utils.parseUnits("1000000", 6); // 1,000,000 USDC to deployer
const PAYER_MINT_AMOUNT = ethers.utils.parseUnits("10000", 6); // 10,000 USDC to Payer

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`[Deployer] ${deployer.address}`);

  console.log(`[Status] Deploying MockUSDC...`);
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.connect(deployer).deploy(INITIAL_SUPPLY);
  await mockUSDC.deployed();

  console.log(`[Address] MockUSDC deployed at ${mockUSDC.address}`);

  console.log(`[Status] Minting 10,000 USDC to Payer (${PAYER_ADDRESS})...`);
  const tx = await mockUSDC.connect(deployer).mint(PAYER_ADDRESS, PAYER_MINT_AMOUNT);
  await tx.wait();

  const balance = await mockUSDC.balanceOf(PAYER_ADDRESS);
  console.log(`[Balance] Payer USDC balance: ${ethers.utils.formatUnits(balance, 6)} USDC`);
  console.log(`[Status] ✅ MockUSDC deployment and mint completed`);
}

main().catch((err) => {
  console.error("[Status] ❌ An error occurred:", err.message);
  process.exit(1);
});
