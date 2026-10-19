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

// ✅ 클라우드 가맹점 주소 (테스트용, MNEMONIC 파생 계정 index 1/2/3)
const CLOUDFLARE_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const KT_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const NCP_ADDRESS = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

// ✅ 이수진 지갑 주소 (MetaMask)
const SUJIN_ADDRESS = "0x2D015f0fB1803B8fb52bFa9eaDF67881D25595d2";

const INITIAL_USDC_SUPPLY = ethers.utils.parseUnits("1000000", 6); // 1,000,000 USDC

// 정부 SLOT 정책
const GOVERNMENT_SLOT_ID = 1;
const GOVERNMENT_BUDGET = ethers.utils.parseUnits("500000", 6); // 50만원

/**
 * 사전 세팅 (Mock)
 * 0. MockUSDC / PBMVault / PBMLogic / PBMWrapper 신규 배포 + 초기화
 * 1. 정부 SLOT 생성 (slotId=1) — 허용 클라우드: Cloudflare, KT, NCP / 예산 50만원
 * 2. 이수진 지갑에 PBM 토큰 발행 — tokenId=1, slot=1, value=500000
 *
 * 실행 주체: 정부/PBM 시스템 운영자 (PBMLogic, PBMWrapper의 owner)
 */
async function main() {
  const missing = Object.entries({ CLOUDFLARE_ADDRESS, KT_ADDRESS, NCP_ADDRESS, SUJIN_ADDRESS })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`다음 주소를 먼저 채워주세요: ${missing.join(", ")}`);
  }

  const [government] = await ethers.getSigners();
  console.log(`[Government/Deployer] ${government.address}`);
  console.log(`[Balance] ${ethers.utils.formatEther(await government.getBalance())} ETH\n`);

  // ── 0. 컨트랙트 배포 ─────────────────────────────────────────────
  console.log(`[1/6] Deploying MockUSDC...`);
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.connect(government).deploy(INITIAL_USDC_SUPPLY);
  await usdc.deployed();
  console.log(`[Address] MockUSDC: ${usdc.address}`);

  console.log(`\n[2/6] Deploying PBMVault...`);
  const PBMVault = await ethers.getContractFactory("contracts/PBMVault.sol:PBMVault");
  const vault = await PBMVault.connect(government).deploy(usdc.address);
  await vault.deployed();
  console.log(`[Address] PBMVault: ${vault.address}`);

  console.log(`\n[3/6] Deploying PBMLogic...`);
  const PBMLogic = await ethers.getContractFactory("PBMLogic");
  const logic = await PBMLogic.connect(government).deploy();
  await logic.deployed();
  console.log(`[Address] PBMLogic: ${logic.address}`);

  console.log(`\n[4/6] Deploying PBMWrapper...`);
  const PBMWrapper = await ethers.getContractFactory("PBMWrapper");
  const wrapper = await PBMWrapper.connect(government).deploy();
  await wrapper.deployed();
  console.log(`[Address] PBMWrapper: ${wrapper.address}`);

  // 일부 RPC의 eth_estimateGas가 부정확한 값을 반환하는 경우가 있어 넉넉한 gasLimit을 명시한다.
  const initTx = await wrapper
    .connect(government)
    .initialize(usdc.address, logic.address, vault.address, { gasLimit: 150_000 });
  await initTx.wait();
  console.log(`[Info] PBMWrapper initialized`);

  const setWrapperTx = await logic.connect(government).setWrapper(wrapper.address, { gasLimit: 100_000 });
  await setWrapperTx.wait();
  console.log(`[Info] Wrapper registered in PBMLogic`);

  // ── 1. 정부 SLOT 생성 (slotId=1) ────────────────────────────────
  console.log(`\n[5/6] Creating government SLOT ${GOVERNMENT_SLOT_ID}...`);
  const whitelist = [CLOUDFLARE_ADDRESS, KT_ADDRESS, NCP_ADDRESS];
  const createSlotTx = await logic
    .connect(government)
    .createSlot(GOVERNMENT_SLOT_ID, whitelist, GOVERNMENT_BUDGET, { gasLimit: 300_000 });
  await createSlotTx.wait();
  console.log(`[Info] SLOT ${GOVERNMENT_SLOT_ID} whitelist:`, whitelist);
  console.log(`[Info] SLOT ${GOVERNMENT_SLOT_ID} budgetLimit: ${ethers.utils.formatUnits(GOVERNMENT_BUDGET, 6)} USDC`);

  // ── 2. 이수진 지갑에 PBM 토큰 발행 (tokenId=1, slot=1, value=500000) ──
  console.log(`\n[6/6] Minting PBM voucher to Sujin (${SUJIN_ADDRESS})...`);
  const approveTx = await usdc
    .connect(government)
    .approve(wrapper.address, GOVERNMENT_BUDGET, { gasLimit: 100_000 });
  await approveTx.wait();

  const mintTx = await wrapper
    .connect(government)
    .mint(SUJIN_ADDRESS, GOVERNMENT_SLOT_ID, GOVERNMENT_BUDGET, { gasLimit: 300_000 });
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
  const tokenId = transferLog.args.tokenId;
  console.log(`[Info] Minted tokenId=${tokenId.toString()} (tx: ${mintReceipt.transactionHash})`);

  // ── 결과 요약 ────────────────────────────────────────────────────
  // ethers Contract에서 "valueOf"는 Object.prototype.valueOf와 이름이 겹쳐 그대로 호출하면
  // 인자를 무시한 채 컨트랙트 객체 자신을 반환한다. 전체 함수 시그니처로 우회 호출한다.
  const policy: Awaited<ReturnType<typeof logic.getSlotPolicy>> = await retry(() =>
    logic.getSlotPolicy(GOVERNMENT_SLOT_ID),
  );
  const tokenValue: import("ethers").BigNumber = await retry(() =>
    (wrapper as any)["valueOf(uint256)"](tokenId),
  );
  const tokenSlot: import("ethers").BigNumber = await retry(() => wrapper.slotOf(tokenId));
  const tokenOwner: string = await retry(() => wrapper.ownerOf(tokenId));

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Result] Mock 사전 세팅 완료 (Base Sepolia 신규 배포)`);
  console.log(`  MockUSDC     : ${usdc.address}`);
  console.log(`  PBMVault     : ${vault.address}`);
  console.log(`  PBMLogic     : ${logic.address}`);
  console.log(`  PBMWrapper   : ${wrapper.address}`);
  console.log(`  Cloudflare   : ${CLOUDFLARE_ADDRESS}`);
  console.log(`  KT           : ${KT_ADDRESS}`);
  console.log(`  NCP          : ${NCP_ADDRESS}`);
  console.log(`  Sujin        : ${SUJIN_ADDRESS}`);
  console.log(`  SLOT ${GOVERNMENT_SLOT_ID}       : budgetLimit=${ethers.utils.formatUnits(policy.budgetLimit, 6)} USDC, budgetUsed=${ethers.utils.formatUnits(policy.budgetUsed, 6)} USDC`);
  console.log(`  tokenId      : ${tokenId.toString()} (owner=${tokenOwner}, slot=${tokenSlot.toString()}, value=${ethers.utils.formatUnits(tokenValue, 6)} USDC)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Status] ✅ Mock 사전 세팅 완료`);
}

main().catch((err) => {
  console.error("[Status] ❌ An error occurred:", err.message);
  process.exit(1);
});
