import { ethers } from "hardhat";

const TX_HASH         = "0x47a3136ff554b1f502c61b82c9998c9adcf49138dfee91eced9ab6d36c3d55c1";
const WRAPPER_ADDRESS = "0x8cB82CCcDbeE66B07f73a88D48F17324CffA8d04";
const LOGIC_ADDRESS   = "0x362eE3eb9FD9cf24c8c997F9D0d4860b252f4c1b";

async function main() {
  const provider = ethers.provider;
  const tx = await provider.getTransaction(TX_HASH);

  console.log("=== 트랜잭션 정보 ===");
  console.log("from     :", tx.from);
  console.log("to       :", tx.to);
  console.log("gasLimit :", tx.gasLimit.toString());
  console.log("selector :", tx.data.slice(0, 10));

  // calldata 디코딩
  const wrapper = await ethers.getContractAt("PBMWrapper", WRAPPER_ADDRESS);
  const logic   = await ethers.getContractAt("PBMLogic",   LOGIC_ADDRESS);

  let payee: string, slotId: any, amount: any;
  try {
    const decoded = wrapper.interface.decodeFunctionData("pay", tx.data);
    payee   = decoded[0];
    slotId  = decoded[1];
    amount  = decoded[2];
    console.log("\n=== pay() 파라미터 ===");
    console.log("payee  :", payee);
    console.log("slotId :", slotId.toString());
    console.log("amount :", ethers.utils.formatUnits(amount, 6), "USDC");
  } catch {
    console.log("calldata 디코딩 실패 — pay() 호출이 아닐 수 있음");
    return;
  }

  // 파라미터 기반 조건 재검증
  console.log("\n=== 파라미터 기반 조건 검증 ===");

  const isPayer = await wrapper.isPayer(tx.from);
  console.log("isPayer(from)       :", isPayer ? "✓" : "✗ Payer 권한 없음");

  const policy = await logic.getSlotPolicy(slotId);
  const inWhitelist = policy.whitelist
    .map((a: string) => a.toLowerCase())
    .includes(payee.toLowerCase());
  console.log("payee in whitelist  :", inWhitelist ? "✓" : "✗ MerchantNotWhitelisted");

  const remaining = policy.budgetLimit.sub(policy.budgetUsed);
  const budgetOk  = amount.lte(remaining);
  console.log("budget remaining    :", ethers.utils.formatUnits(remaining, 6), "USDC");
  console.log("amount <= remaining :", budgetOk ? "✓" : "✗ BudgetExceeded");

  console.log("\n=== 결론 ===");
  if (!isPayer)       console.log("  원인: CallerNotPayer — from 주소 Payer 미등록");
  if (!inWhitelist)   console.log("  원인: MerchantNotWhitelisted — payee(" + payee + ") 화이트리스트 미등록");
  if (!budgetOk)      console.log("  원인: BudgetExceeded — 요청 금액이 잔여 예산 초과");
  if (isPayer && inWhitelist && budgetOk)
    console.log("  모든 조건 충족 — USDC transferFrom 또는 ERC-3525 mint 단계 문제 가능성");
}

main().catch((err) => { console.error(err); process.exit(1); });
