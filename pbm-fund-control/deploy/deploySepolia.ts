import { ethers } from "hardhat";
import path from "path";

const INITIAL_USDC_SUPPLY = ethers.utils.parseUnits("1000000", 6); // 1,000,000 USDC
const GOVERNMENT_RESERVE_MINT = ethers.utils.parseUnits("10000", 6); // 10,000 USDC (바우처 발행 재원)

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log(`[Deployer] ${deployerAddress}`);
  console.log(`[Balance] ${ethers.utils.formatEther(await deployer.getBalance())} ETH\n`);

  // ── 1. MockUSDC ───────────────────────────────────────────────────
  console.log(`[1/4] Deploying MockUSDC...`);
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.connect(deployer).deploy(INITIAL_USDC_SUPPLY);
  await mockUSDC.deployed();
  console.log(`[Address] MockUSDC: ${mockUSDC.address}`);

  // 일부 RPC의 eth_estimateGas가 부정확한 값을 반환하는 경우가 있어 넉넉한 gasLimit을 명시한다.
  const mintTx = await mockUSDC.mint(deployerAddress, GOVERNMENT_RESERVE_MINT, { gasLimit: 150_000 });
  await mintTx.wait();
  console.log(`[Info] Minted 10,000 USDC to deployer (government voucher reserve)\n`);

  // ── 2. PBMVault ───────────────────────────────────────────────────
  console.log(`[2/4] Deploying PBMVault...`);
  const PBMVault = await ethers.getContractFactory("contracts/PBMVault.sol:PBMVault");
  const pbmVault = await PBMVault.connect(deployer).deploy(mockUSDC.address);
  await pbmVault.deployed();
  console.log(`[Address] PBMVault: ${pbmVault.address}\n`);

  // ── 3. PBMLogic ───────────────────────────────────────────────────
  console.log(`[3/4] Deploying PBMLogic...`);
  const PBMLogic = await ethers.getContractFactory("PBMLogic");
  const pbmLogic = await PBMLogic.connect(deployer).deploy();
  await pbmLogic.deployed();
  console.log(`[Address] PBMLogic: ${pbmLogic.address}\n`);

  // ── 4. PBMWrapper ─────────────────────────────────────────────────
  console.log(`[4/4] Deploying PBMWrapper...`);
  const PBMWrapper = await ethers.getContractFactory("PBMWrapper");
  const pbmWrapper = await PBMWrapper.connect(deployer).deploy();
  await pbmWrapper.deployed();
  console.log(`[Address] PBMWrapper: ${pbmWrapper.address}`);

  // initialize
  const initTx = await pbmWrapper.initialize(
    mockUSDC.address,
    pbmLogic.address,
    pbmVault.address,
    { gasLimit: 150_000 }
  );
  await initTx.wait();
  console.log(`[Info] PBMWrapper initialized`);

  // PBMLogic에 Wrapper 등록 (updateBudgetUsed 호출 권한)
  const setWrapperTx = await pbmLogic.setWrapper(pbmWrapper.address, { gasLimit: 100_000 });
  await setWrapperTx.wait();
  console.log(`[Info] Wrapper registered in PBMLogic\n`);

  // ── 결과 요약 ─────────────────────────────────────────────────────
  const abiPath = path.resolve(
    __dirname,
    "../artifacts/contracts/PBMWrapper.sol/PBMWrapper.json"
  );

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Result] Sepolia Deployment Summary`);
  console.log(`  MockUSDC  : ${mockUSDC.address}`);
  console.log(`  PBMVault  : ${pbmVault.address}`);
  console.log(`  PBMLogic  : ${pbmLogic.address}`);
  console.log(`  PBMWrapper: ${pbmWrapper.address}`);
  console.log(`  ABI Path  : ${abiPath}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Status] ✅ All contracts deployed to Sepolia`);
}

main().catch((err) => {
  console.error("[Status] ❌ An error occurred:", err.message);
  process.exit(1);
});
