import { ethers } from "hardhat";

const PBM_LOGIC_ADDRESS   = "0x362eE3eb9FD9cf24c8c997F9D0d4860b252f4c1b";
const PBM_WRAPPER_ADDRESS = "0x8cB82CCcDbeE66B07f73a88D48F17324CffA8d04";

const TARGET_ADDRESS = "0x592f0b83294694b074e4e5ac433213f1e92f3caa";
const SLOT_ID = 1;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Caller:", deployer.address);

  const logic   = await ethers.getContractAt("PBMLogic",   PBM_LOGIC_ADDRESS);
  const wrapper = await ethers.getContractAt("PBMWrapper", PBM_WRAPPER_ADDRESS);

  // ── Step 1: PBMLogic 화이트리스트에서 제거 ────────────────────
  console.log(`\n[1] Removing ${TARGET_ADDRESS} from whitelist (slot ${SLOT_ID})...`);
  const tx1 = await logic.removeFromWhitelist(SLOT_ID, TARGET_ADDRESS);
  console.log("    Tx:", tx1.hash);
  await tx1.wait();
  console.log("    Done.");

  // ── Step 2: PBMWrapper에 Payer 권한 부여 ─────────────────────
  console.log(`\n[2] Adding ${TARGET_ADDRESS} as payer...`);
  const tx2 = await wrapper.addPayer(TARGET_ADDRESS);
  console.log("    Tx:", tx2.hash);
  await tx2.wait();
  console.log("    Done.");

  // ── 결과 확인 ─────────────────────────────────────────────────
  console.log("\n[Result]");

  const policy = await logic.getSlotPolicy(SLOT_ID);
  const inWhitelist = policy.whitelist
    .map((a: string) => a.toLowerCase())
    .includes(TARGET_ADDRESS.toLowerCase());
  console.log("  Whitelist removed:", !inWhitelist ? "✓" : "✗ (still in list)");

  const isPayer = await wrapper.isPayer(TARGET_ADDRESS);
  console.log("  Payer granted    :", isPayer ? "✓" : "✗ (not set)");

  if (inWhitelist || !isPayer) {
    throw new Error("Role update verification failed.");
  }
  console.log("\nRole update completed successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
