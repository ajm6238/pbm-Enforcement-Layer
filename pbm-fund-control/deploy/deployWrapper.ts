import { ethers } from "hardhat";
import path from "path";

// ✅ 이전 배포 스크립트 실행 결과에서 확인한 주소로 교체하세요
const MOCK_USDC_ADDRESS  = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const PBM_VAULT_ADDRESS  = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"; // deployVault.ts 실행 결과의 [Address] 값
const PBM_LOGIC_ADDRESS  = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"; // deployLogic.ts 실행 결과의 [Address] 값

async function main() {
  if (!PBM_VAULT_ADDRESS || !PBM_LOGIC_ADDRESS) {
    throw new Error(
      "PBM_VAULT_ADDRESS 또는 PBM_LOGIC_ADDRESS가 설정되지 않았습니다.\n" +
      "deployVault.ts와 deployLogic.ts를 먼저 실행하고 주소를 입력하세요."
    );
  }

  const [deployer] = await ethers.getSigners();
  console.log(`[Deployer] ${deployer.address}`);

  // 1. PBMWrapper 배포
  console.log(`[Status] Deploying PBMWrapper...`);
  const PBMWrapper = await ethers.getContractFactory("PBMWrapper");
  const pbmWrapper = await PBMWrapper.connect(deployer).deploy();
  await pbmWrapper.deployed();
  console.log(`[Address] PBMWrapper deployed at ${pbmWrapper.address}`);

  // 2. initialize: USDC, Logic, Vault 연결
  console.log(`[Status] Initializing PBMWrapper...`);
  const initTx = await pbmWrapper.initialize(
    MOCK_USDC_ADDRESS,
    PBM_LOGIC_ADDRESS,
    PBM_VAULT_ADDRESS
  );
  await initTx.wait();
  console.log(`[Info] USDC  : ${MOCK_USDC_ADDRESS}`);
  console.log(`[Info] Logic : ${PBM_LOGIC_ADDRESS}`);
  console.log(`[Info] Vault : ${PBM_VAULT_ADDRESS}`);

  // 3. PBMLogic에 Wrapper 주소 등록 (updateBudgetUsed 호출 권한)
  console.log(`[Status] Setting Wrapper as Logic's wrapper...`);
  const pbmLogic = await ethers.getContractAt("PBMLogic", PBM_LOGIC_ADDRESS);
  const wrapperTx = await pbmLogic.setWrapper(pbmWrapper.address);
  await wrapperTx.wait();
  console.log(`[Info] Wrapper registered in PBMLogic`);

  // 4. ABI 경로 출력
  const abiPath = path.resolve(
    __dirname,
    "../artifacts/contracts/PBMWrapper.sol/PBMWrapper.json"
  );
  console.log(`[ABI] PBMWrapper ABI: ${abiPath}`);

  console.log(`[Status] ✅ PBMWrapper deployment and setup completed`);
}

main().catch((err) => {
  console.error("[Status] ❌ An error occurred:", err.message);
  process.exit(1);
});
