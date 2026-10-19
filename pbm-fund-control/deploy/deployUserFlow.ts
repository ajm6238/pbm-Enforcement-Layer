import { ethers } from "hardhat";

// 일부 RPC는 트랜잭션 확정 직후 상태 조회에 read-after-write 지연이 있어, 결과 요약 조회는
// 짧게 재시도한다.
async function retry<T>(fn: () => Promise<T>, attempts = 5, delayMs = 2000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// ✅ deployMock.ts 실행에 사용한 것과 동일한 주소 (Base Sepolia)
const PBM_LOGIC_ADDRESS = "0xc2758aF169520424a282B1cf821251EBAAd627DE";
const PBM_WRAPPER_ADDRESS = "0x2B313076BB5E0CcA650E387442ac024b17d30927";

const CLOUDFLARE_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SUJIN_ADDRESS = "0x2D015f0fB1803B8fb52bFa9eaDF67881D25595d2";

// ✅ Agent 지갑 (Base Sepolia) — AGENT_PRIVATE_KEY로 복원되는 실제 주소
const AGENT_ADDRESS = "0xdFeaaC981817AF5F527728d2F66E55ba8bDc3708";

// ✅ 이수진 지갑의 개인키. SLOT 생성/토큰 발행은 정부(.env의 PRIVATE_KEY)가 실행하지만,
//    자신의 토큰(tokenId)에 대한 value 이동/Mandate 등록/Agent 위임은 토큰 소유자인
//    이수진 본인 서명이 있어야 하므로 별도 환경변수로 받는다.
const SUJIN_PRIVATE_KEY = process.env.SUJIN_PRIVATE_KEY || "";

const GOVERNMENT_TOKEN_ID = 1; // deployMock.ts에서 발행된 tokenId
const USER_SLOT_ID = 2;
const USER_BUDGET = ethers.utils.parseUnits("300000", 6); // 30만원
const TRANSFER_AMOUNT = ethers.utils.parseUnits("300000", 6); // 30만원
const AUTO_LIMIT = ethers.utils.parseUnits("30000", 6); // 자율 결제 한도 3만원
const MANDATE_PERIOD_SECONDS = 6 * 30 * 24 * 60 * 60; // 위임 기간 약 6개월

/**
 * 시연 흐름
 * 3. 이수진이 자기 SLOT 생성 (slotId=2) — Cloudflare만 허용, 예산 30만원
 * 4. tokenId=1 → tokenId=2로 value 이동 (transferValue)
 * 5-6. 이수진이 Mandate 조건 등록 + Agent에게 tokenId=2 위임
 */
async function main() {
  const missing = Object.entries({
    PBM_LOGIC_ADDRESS,
    PBM_WRAPPER_ADDRESS,
    CLOUDFLARE_ADDRESS,
    SUJIN_ADDRESS,
    SUJIN_PRIVATE_KEY,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `다음 값을 먼저 채워주세요: ${missing.join(", ")} (SUJIN_PRIVATE_KEY는 환경변수로 설정)`,
    );
  }

  const [government] = await ethers.getSigners();
  const sujin = new ethers.Wallet(SUJIN_PRIVATE_KEY, ethers.provider);
  if (sujin.address.toLowerCase() !== SUJIN_ADDRESS.toLowerCase()) {
    throw new Error(
      `SUJIN_PRIVATE_KEY가 SUJIN_ADDRESS(${SUJIN_ADDRESS})와 일치하지 않습니다. (복원된 주소: ${sujin.address})`,
    );
  }
  console.log(`[Government/Deployer] ${government.address}`);
  console.log(`[Sujin] ${sujin.address}`);

  const logic = await ethers.getContractAt("PBMLogic", PBM_LOGIC_ADDRESS);
  const wrapper = await ethers.getContractAt("PBMWrapper", PBM_WRAPPER_ADDRESS);

  // ── 3. 이수진 SLOT 생성 (slotId=2, Cloudflare만 허용) ──────────────
  // createSlot은 PBMLogic owner(정부/운영자) 권한으로 실행되며, 이수진이 앱에서 설정한
  // 정책(Cloudflare만 / 30만원)을 온체인에 반영한다. 빈 바우처(tokenId=2, value=0)도
  // 같은 단계에서 이수진 앞으로 발행해 이후 transferValue의 대상 토큰으로 사용한다.
  console.log(`\n[1/4] Creating Sujin's SLOT ${USER_SLOT_ID}...`);
  // 일부 RPC의 eth_estimateGas가 부정확한 값을 반환하는 경우가 있어 넉넉한 gasLimit을 명시한다.
  const createSlotTx = await logic
    .connect(government)
    .createSlot(USER_SLOT_ID, [CLOUDFLARE_ADDRESS], USER_BUDGET, { gasLimit: 300_000 });
  await createSlotTx.wait();

  console.log(`[2/4] Minting empty voucher shell for Sujin (slot=${USER_SLOT_ID})...`);
  const mintTx = await wrapper.connect(government).mint(sujin.address, USER_SLOT_ID, 0, { gasLimit: 300_000 });
  const mintReceipt = await mintTx.wait();
  // 일부 RPC는 트랜잭션 확정 직후의 상태 조회(currentTokenId 등)가 최신 블록을 반영하지
  // 못하는 지연이 있을 수 있어, 방금 발생한 영수증의 Transfer 로그에서 tokenId를 직접 읽는다.
  const transferLog = mintReceipt.logs
    .map((log: any) => {
      try {
        return wrapper.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: any) => parsed?.name === "Transfer");
  if (!transferLog) {
    throw new Error("mint 영수증에서 Transfer 이벤트를 찾지 못했습니다.");
  }
  const userTokenId = transferLog.args.tokenId;
  console.log(`[Info] Sujin's tokenId=${userTokenId.toString()} minted (value=0)`);

  // ── 4. tokenId=1 → tokenId=2 value 이동 ────────────────────────────
  console.log(`\n[3/4] Transferring value: tokenId=${GOVERNMENT_TOKEN_ID} -> tokenId=${userTokenId.toString()}...`);
  const transferTx = await wrapper
    .connect(sujin)
    .transferValue(GOVERNMENT_TOKEN_ID, userTokenId, TRANSFER_AMOUNT, { gasLimit: 200_000 });
  await transferTx.wait();

  // ── 5-6. Mandate 등록 + Agent 위임 ──────────────────────────────────
  const expiresAt = Math.floor(Date.now() / 1000) + MANDATE_PERIOD_SECONDS;
  console.log(`\n[4/4] Setting mandate condition + delegating to Agent (${AGENT_ADDRESS})...`);
  const mandateTx = await wrapper.connect(sujin).setMandateCondition(
    userTokenId,
    {
      agentAddress: AGENT_ADDRESS,
      autoLimit: AUTO_LIMIT,
      expiresAt,
      allowedVendors: [CLOUDFLARE_ADDRESS],
    },
    { gasLimit: 150_000 },
  );
  await mandateTx.wait();

  // approve(uint256,address)는 ERC-721 approve(address,uint256) / ERC-3525
  // approve(uint256,address,uint256)와 이름이 겹치는 오버로드라 ethers가 축약형(wrapper.approve)을
  // 노출하지 않는다. 전체 시그니처로 명시 호출한다.
  const approveTx = await wrapper
    .connect(sujin)
    ["approve(uint256,address)"](userTokenId, AGENT_ADDRESS, { gasLimit: 100_000 });
  await approveTx.wait();

  // ── 결과 요약 ────────────────────────────────────────────────────
  // valueOf는 Object.prototype.valueOf와 이름이 겹쳐 전체 시그니처로 명시 호출해야 한다.
  const govTokenValue: import("ethers").BigNumber = await retry(() =>
    (wrapper as any)["valueOf(uint256)"](GOVERNMENT_TOKEN_ID),
  );
  const userTokenValue: import("ethers").BigNumber = await retry(() =>
    (wrapper as any)["valueOf(uint256)"](userTokenId),
  );
  const mandate: Awaited<ReturnType<typeof wrapper.getMandateCondition>> = await retry(() =>
    wrapper.getMandateCondition(userTokenId),
  );
  // agentOf는 approve 트랜잭션 확정 직후 곧바로 읽으면 read-after-write 지연으로 예외 없이
  // 갱신 전 값(zero address)을 반환할 수 있어, 기대값과 일치할 때까지 짧게 재조회한다.
  let agent: string = await wrapper.agentOf(userTokenId);
  for (let i = 0; i < 4 && agent.toLowerCase() !== AGENT_ADDRESS.toLowerCase(); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    agent = await wrapper.agentOf(userTokenId);
  }
  const policy: Awaited<ReturnType<typeof logic.getSlotPolicy>> = await retry(() =>
    logic.getSlotPolicy(USER_SLOT_ID),
  );

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Result] 시연 흐름 (사용자 SLOT/위임) 완료`);
  console.log(`  tokenId=${GOVERNMENT_TOKEN_ID} (정부) value : ${ethers.utils.formatUnits(govTokenValue, 6)} USDC`);
  console.log(`  tokenId=${userTokenId.toString()} (이수진) value : ${ethers.utils.formatUnits(userTokenValue, 6)} USDC`);
  console.log(`  SLOT ${USER_SLOT_ID} whitelist : ${policy.whitelist}`);
  console.log(`  SLOT ${USER_SLOT_ID} budgetLimit: ${ethers.utils.formatUnits(policy.budgetLimit, 6)} USDC`);
  console.log(`  Mandate: agent=${mandate.agentAddress}, autoLimit=${ethers.utils.formatUnits(mandate.autoLimit, 6)} USDC, expiresAt=${new Date(mandate.expiresAt.toNumber() * 1000).toISOString()}, allowedVendors=${mandate.allowedVendors}`);
  console.log(`  Approved agent for tokenId=${userTokenId.toString()}: ${agent}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Status] ✅ 시연 흐름 완료`);
}

main().catch((err) => {
  console.error("[Status] ❌ An error occurred:", err.message);
  process.exit(1);
});
