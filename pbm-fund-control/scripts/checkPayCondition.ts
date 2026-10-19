import { ethers } from "hardhat";

const USDC_ADDRESS    = "0x3D63CE21372BFb16d5Ab26DD17Cb22FBBAF54139";
const LOGIC_ADDRESS   = "0x362eE3eb9FD9cf24c8c997F9D0d4860b252f4c1b";
const WRAPPER_ADDRESS = "0x8cB82CCcDbeE66B07f73a88D48F17324CffA8d04";

const PAYER_ADDRESS   = "0x592f0b83294694b074e4e5ac433213f1e92f3caa";
const MERCHANT_ADDRESS = "0x6122F12d01C71BC51b7BCc0cac7483e5c0352461";
const SLOT_ID = 1;

function ok(val: boolean) { return val ? "✓" : "✗ FAIL"; }

async function main() {
  const usdc    = await ethers.getContractAt("MockUSDC",    USDC_ADDRESS);
  const logic   = await ethers.getContractAt("PBMLogic",   LOGIC_ADDRESS);
  const wrapper = await ethers.getContractAt("PBMWrapper", WRAPPER_ADDRESS);

  console.log("=== pay() 사전 조건 점검 ===\n");

  // 1. USDC 잔액
  const balance = await usdc.balanceOf(PAYER_ADDRESS);
  console.log("[1] Payer USDC 잔액");
  console.log("    ", ethers.utils.formatUnits(balance, 6), "USDC", balance.gt(0) ? "✓" : "✗ FAIL (잔액 없음)");

  // 2. USDC approve
  const allowance = await usdc.allowance(PAYER_ADDRESS, WRAPPER_ADDRESS);
  console.log("\n[2] USDC approve (allowance)");
  console.log("    allowance:", ethers.utils.formatUnits(allowance, 6), "USDC", allowance.gt(0) ? "✓" : "✗ FAIL (approve 안 됨)");

  // 3. Payer 권한
  const isPayer = await wrapper.isPayer(PAYER_ADDRESS);
  console.log("\n[3] Payer 권한 (isPayer)");
  console.log("    ", ok(isPayer));

  // 4. 슬롯 정책
  const policy = await logic.getSlotPolicy(SLOT_ID);
  const budgetRemaining = policy.budgetLimit.sub(policy.budgetUsed);
  const merchantInList = policy.whitelist
    .map((a: string) => a.toLowerCase())
    .includes(MERCHANT_ADDRESS.toLowerCase());

  console.log("\n[4] Slot", SLOT_ID, "정책");
  console.log("    budgetLimit    :", ethers.utils.formatUnits(policy.budgetLimit, 6), "USDC");
  console.log("    budgetUsed     :", ethers.utils.formatUnits(policy.budgetUsed, 6), "USDC");
  console.log("    budgetRemaining:", ethers.utils.formatUnits(budgetRemaining, 6), "USDC", budgetRemaining.gt(0) ? "✓" : "✗ FAIL (예산 초과)");
  console.log("    whitelist      :", policy.whitelist);
  console.log("    merchant 등록  :", ok(merchantInList));

  // 5. 종합 판단
  console.log("\n=== 종합 판단 ===");
  const issues: string[] = [];
  if (balance.eq(0))       issues.push("Payer USDC 잔액 없음");
  if (allowance.eq(0))     issues.push("USDC approve 안 됨 → approve(PBMWrapper, amount) 필요");
  if (!isPayer)            issues.push("Payer 권한 없음");
  if (!merchantInList)     issues.push("가맹점이 화이트리스트에 없음");
  if (budgetRemaining.eq(0)) issues.push("예산 소진됨");

  if (issues.length === 0) {
    console.log("모든 조건 충족 — revert 원인이 다른 곳에 있을 수 있음");
  } else {
    issues.forEach((msg) => console.log("  ✗", msg));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
