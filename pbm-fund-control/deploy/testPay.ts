import { ethers } from "hardhat";
import { BigNumber, Contract } from "ethers";

// ethers Contract에서 "valueOf"는 Object.prototype.valueOf와 이름이 겹쳐 그대로 호출하면
// 인자를 무시한 채 컨트랙트 객체 자신을 반환한다. 전체 함수 시그니처로 우회 호출한다.
function valueOf(wrapper: Contract, tokenId: number): Promise<BigNumber> {
  return (wrapper as any)["valueOf(uint256)"](tokenId);
}

// ✅ deployMock.ts / deployUserFlow.ts 실행에 사용한 것과 동일한 주소 (Base Sepolia)
const PBM_WRAPPER_ADDRESS = "0x2B313076BB5E0CcA650E387442ac024b17d30927";
const CLOUDFLARE_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
// deployMock.ts와 동일한 KT 주소. deployUserFlow.ts가 Mandate.allowedVendors에 Cloudflare만
// 넣어두므로, 이 주소로의 결제는 VendorNotAllowedByMandate로 막혀야 한다.
const KT_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

// ✅ Agent 지갑 (Base Sepolia) — AGENT_PRIVATE_KEY로 복원되는 실제 주소.
//    Base Sepolia 테스트 ETH가 있어야 pay()를 직접 서명할 수 있다 (예: coinbase.com/faucets).
const AGENT_ADDRESS = "0xdFeaaC981817AF5F527728d2F66E55ba8bDc3708";
// ✅ Agent 지갑의 개인키. pay()는 approve된 Agent 본인 서명으로 호출해야 한다.
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || "";

const USER_TOKEN_ID = 2; // deployUserFlow.ts에서 이수진에게 발행된 tokenId
const PAY_AMOUNT = ethers.utils.parseUnits("20000", 6); // 2만원 (한도 3만원 이내)
const OVER_LIMIT_AMOUNT = ethers.utils.parseUnits("40000", 6); // 4만원 (한도 3만원 초과)
const PURPOSE = "cloudflare_workers_ai";

/**
 * 결제 테스트
 * 7. Agent가 pay(tokenId=2, cloudflare, 20000, purpose) 호출 → 정상 결제
 * 8-9. 3만원 초과 결제 시도 → AutoLimitExceededError로 revert (결제 자체가 차단됨)
 * 10. Mandate.allowedVendors(Cloudflare만) 밖의 KT 주소로 결제 시도
 *     → VendorNotAllowedByMandate로 revert (결제 자체가 차단됨)
 */
async function main() {
  const missing = Object.entries({ PBM_WRAPPER_ADDRESS, CLOUDFLARE_ADDRESS, AGENT_PRIVATE_KEY })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`다음 값을 먼저 채워주세요: ${missing.join(", ")} (AGENT_PRIVATE_KEY는 환경변수로 설정)`);
  }

  const agent = new ethers.Wallet(AGENT_PRIVATE_KEY, ethers.provider);
  if (agent.address.toLowerCase() !== AGENT_ADDRESS.toLowerCase()) {
    throw new Error(`AGENT_PRIVATE_KEY가 AGENT_ADDRESS(${AGENT_ADDRESS})와 일치하지 않습니다. (복원된 주소: ${agent.address})`);
  }
  console.log(`[Agent] ${agent.address}`);

  const wrapper = await ethers.getContractAt("PBMWrapper", PBM_WRAPPER_ADDRESS);

  // ── 7. 정상 결제 (한도 이내) ─────────────────────────────────────
  const before = await valueOf(wrapper, USER_TOKEN_ID);
  console.log(`\n[1/3] tokenId=${USER_TOKEN_ID} value before: ${ethers.utils.formatUnits(before, 6)} USDC`);

  console.log(`[Status] Agent paying ${ethers.utils.formatUnits(PAY_AMOUNT, 6)} USDC to Cloudflare (${CLOUDFLARE_ADDRESS})...`);
  // 일부 RPC의 eth_estimateGas가 부정확한 값을 반환하는 경우가 있어 넉넉한 gasLimit을 명시한다.
  const payTx = await wrapper
    .connect(agent)
    .pay(USER_TOKEN_ID, CLOUDFLARE_ADDRESS, PAY_AMOUNT, PURPOSE, { gasLimit: 250_000 });
  const payReceipt = await payTx.wait();

  const paymentEvent = payReceipt.events?.find((e: any) => e.event === "Payment");
  console.log(`[Info] Payment event:`, paymentEvent?.args);

  // 일부 RPC는 트랜잭션 확정 직후 상태 조회가 최신 블록을 반영하지 못하는 지연이 있어
  // (read-after-write), 기대값과 일치할 때까지 짧게 재조회한다.
  let after = await valueOf(wrapper, USER_TOKEN_ID);
  for (let i = 0; i < 4 && !before.sub(after).eq(PAY_AMOUNT); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    after = await valueOf(wrapper, USER_TOKEN_ID);
  }
  console.log(`[Info] tokenId=${USER_TOKEN_ID} value after : ${ethers.utils.formatUnits(after, 6)} USDC`);
  if (!before.sub(after).eq(PAY_AMOUNT)) {
    throw new Error("결제 후 tokenId value 차감이 예상과 다릅니다.");
  }
  console.log(`[Status] ✅ 정상 결제 확인 (value 차감 = ${ethers.utils.formatUnits(PAY_AMOUNT, 6)} USDC)`);

  // ── 8-9. 한도(3만원) 초과 결제 시도 → revert 확인 ──────────────────
  console.log(`\n[2/3] Agent attempting over-limit payment (${ethers.utils.formatUnits(OVER_LIMIT_AMOUNT, 6)} USDC > autoLimit)...`);
  const beforeOver = await valueOf(wrapper, USER_TOKEN_ID);

  let reverted = false;
  let revertReason = "";
  try {
    await wrapper.connect(agent).callStatic.pay(USER_TOKEN_ID, CLOUDFLARE_ADDRESS, OVER_LIMIT_AMOUNT, PURPOSE);
  } catch (err: any) {
    reverted = true;
    revertReason = err.errorName ?? err.reason ?? err.message;
  }

  const afterOver = await valueOf(wrapper, USER_TOKEN_ID);

  if (!reverted) {
    throw new Error("한도 초과 결제가 revert되지 않았습니다.");
  }
  if (!revertReason.includes("AutoLimitExceededError") && !revertReason.includes("AutoLimitExceeded")) {
    throw new Error(`예상과 다른 사유로 revert되었습니다: ${revertReason}`);
  }
  if (!beforeOver.eq(afterOver)) {
    throw new Error("한도 초과 결제인데 tokenId value가 변경되었습니다.");
  }
  console.log(`[Info] Reverted as expected: ${revertReason}`);
  console.log(`[Info] tokenId=${USER_TOKEN_ID} value unchanged: ${ethers.utils.formatUnits(afterOver, 6)} USDC`);
  console.log(`[Status] ✅ 한도 초과 결제가 AutoLimitExceededError로 차단되었습니다.`);

  // ── 10. allowedVendors 밖의 벤더(KT)로 결제 시도 → revert 확인 ──────
  console.log(`\n[3/3] Agent attempting payment to non-whitelisted vendor KT (${KT_ADDRESS})...`);
  const beforeVendor = await valueOf(wrapper, USER_TOKEN_ID);

  let vendorReverted = false;
  let vendorRevertReason = "";
  try {
    await wrapper.connect(agent).callStatic.pay(USER_TOKEN_ID, KT_ADDRESS, PAY_AMOUNT, PURPOSE);
  } catch (err: any) {
    vendorReverted = true;
    vendorRevertReason = err.errorName ?? err.reason ?? err.message;
  }

  const afterVendor = await valueOf(wrapper, USER_TOKEN_ID);

  if (!vendorReverted) {
    throw new Error("허용되지 않은 벤더(KT) 결제가 revert되지 않았습니다.");
  }
  if (!vendorRevertReason.includes("VendorNotAllowedByMandate")) {
    throw new Error(`예상과 다른 사유로 revert되었습니다: ${vendorRevertReason}`);
  }
  if (!beforeVendor.eq(afterVendor)) {
    throw new Error("벤더 제한으로 차단됐어야 할 결제인데 tokenId value가 변경되었습니다.");
  }
  console.log(`[Info] Reverted as expected: ${vendorRevertReason}`);
  console.log(`[Info] tokenId=${USER_TOKEN_ID} value unchanged: ${ethers.utils.formatUnits(afterVendor, 6)} USDC`);
  console.log(`[Status] ✅ 화이트리스트 밖 벤더(KT) 결제가 VendorNotAllowedByMandate로 차단되었습니다.`);
}

main().catch((err) => {
  console.error("[Status] ❌ An error occurred:", err.message);
  process.exit(1);
});
