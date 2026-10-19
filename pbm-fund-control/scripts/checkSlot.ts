import { ethers } from "hardhat";

async function main() {
  const logic = await ethers.getContractAt("PBMLogic", "0x362eE3eb9FD9cf24c8c997F9D0d4860b252f4c1b");
  const wrapper = await ethers.getContractAt("PBMWrapper", "0x8cB82CCcDbeE66B07f73a88D48F17324CffA8d04");

  const policy = await logic.getSlotPolicy(1);
  console.log("=== Slot 1 상태 ===");
  console.log("budgetLimit:", ethers.utils.formatUnits(policy.budgetLimit, 6), "USDC");
  console.log("budgetUsed :", ethers.utils.formatUnits(policy.budgetUsed, 6), "USDC");
  console.log("whitelist  :", policy.whitelist);

  const OLD = "0x592f0b83294694b074e4e5ac433213f1e92f3caa";
  const NEW = "0x6122F12d01C71BC51b7BCc0cac7483e5c0352461";
  const lower = policy.whitelist.map((a: string) => a.toLowerCase());

  console.log("\n=== 주소 역할 확인 ===");
  console.log(`${OLD}`);
  console.log(`  화이트리스트: ${lower.includes(OLD.toLowerCase()) ? "✓ 있음" : "✗ 없음 (제거됨)"}`);
  console.log(`  Payer       : ${await wrapper.isPayer(OLD) ? "✓ 있음" : "✗ 없음"}`);

  console.log(`${NEW}`);
  console.log(`  화이트리스트: ${lower.includes(NEW.toLowerCase()) ? "✓ 있음" : "✗ 없음"}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
