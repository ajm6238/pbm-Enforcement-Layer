import { ethers } from "hardhat";

const PBM_LOGIC_ADDRESS = "0x362eE3eb9FD9cf24c8c997F9D0d4860b252f4c1b";

const SLOT_ID      = 1;
const WHITELIST    = ["0x592f0b83294694b074e4e5ac433213f1e92f3caa"];
const BUDGET_LIMIT = ethers.utils.parseUnits("1000", 6); // 1000 USDC

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Caller:", deployer.address);

  const logic = await ethers.getContractAt("PBMLogic", PBM_LOGIC_ADDRESS);

  // ── createSlot ──────────────────────────────────────────────
  console.log(`\nCreating slot ${SLOT_ID}...`);
  const tx = await logic.createSlot(SLOT_ID, WHITELIST, BUDGET_LIMIT);
  console.log("Tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  // ── 결과 확인 ────────────────────────────────────────────────
  const policy = await logic.getSlotPolicy(SLOT_ID);
  console.log("\n[Slot Policy]");
  console.log("  budgetLimit :", ethers.utils.formatUnits(policy.budgetLimit, 6), "USDC");
  console.log("  budgetUsed  :", ethers.utils.formatUnits(policy.budgetUsed, 6), "USDC");
  console.log("  whitelist   :", policy.whitelist);

  if (!policy.whitelist.map((a: string) => a.toLowerCase()).includes(WHITELIST[0].toLowerCase())) {
    throw new Error("Whitelist address not registered!");
  }
  console.log("\nSlot created successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
