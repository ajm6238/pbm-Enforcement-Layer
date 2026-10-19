import { ethers } from "hardhat";

const MOCK_USDC_ADDRESS = "0x3D63CE21372BFb16d5Ab26DD17Cb22FBBAF54139";
const TO_ADDRESS        = "0x592f0b83294694b074e4e5ac433213f1e92f3caa";
const MINT_AMOUNT       = ethers.utils.parseUnits("10000", 6);

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Caller:", deployer.address);

  const usdc = await ethers.getContractAt("MockUSDC", MOCK_USDC_ADDRESS);

  const before = await usdc.balanceOf(TO_ADDRESS);
  console.log("\nBefore:", ethers.utils.formatUnits(before, 6), "USDC");

  console.log(`\nMinting 10,000 USDC to ${TO_ADDRESS}...`);
  const tx = await usdc.mint(TO_ADDRESS, MINT_AMOUNT);
  console.log("Tx:", tx.hash);
  await tx.wait();

  const after = await usdc.balanceOf(TO_ADDRESS);
  console.log("After :", ethers.utils.formatUnits(after, 6), "USDC");

  if (after.sub(before).lt(MINT_AMOUNT)) throw new Error("Mint amount mismatch.");
  console.log("\nMint successful.");
}

main().catch((err) => { console.error(err); process.exit(1); });
