import { ethers } from "hardhat";

const PBM_LOGIC_ADDRESS = "0x362eE3eb9FD9cf24c8c997F9D0d4860b252f4c1b";
const MERCHANT_ADDRESS  = "0x6122F12d01C71BC51b7BCc0cac7483e5c0352461";
const SLOT_ID = 1;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Caller:", deployer.address);

  const logic = await ethers.getContractAt("PBMLogic", PBM_LOGIC_ADDRESS);

  console.log(`\nAdding merchant ${MERCHANT_ADDRESS} to whitelist (slot ${SLOT_ID})...`);
  const tx = await logic.addToWhitelist(SLOT_ID, MERCHANT_ADDRESS);
  console.log("Tx:", tx.hash);
  await tx.wait();

  // 확인
  const policy = await logic.getSlotPolicy(SLOT_ID);
  const inWhitelist = policy.whitelist
    .map((a: string) => a.toLowerCase())
    .includes(MERCHANT_ADDRESS.toLowerCase());

  console.log("Whitelisted:", inWhitelist ? "✓" : "✗");
  console.log("Current whitelist:", policy.whitelist);

  if (!inWhitelist) throw new Error("Whitelist update failed.");
  console.log("\nMerchant added successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
