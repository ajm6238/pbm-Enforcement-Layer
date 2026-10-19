# AI Agent 결제환경에서의 PBM 기반 자금 통제 모델 제안

「AI Agent 결제환경에서의 PBM 기반 자금 통제 모델 제안」 (KIPS 2026) 논문의 스마트 컨트랙트 구현 코드입니다.

> **A Proposal for a PBM-Based Fund Control Model in AI Agent Payment Environments**
> 안진모, 김나경, 임이주, 장보경, 육은서, 변재영

## 개요

AI Agent가 상품 탐색부터 결제까지 수행하는 Agentic Commerce 환경에서는, Agent의 판단 오류나 Prompt Injection 같은 외부 공격으로 사용자의 의도와 다른 결제가 발생할 수 있습니다.

이 저장소는 AI Agent와 실제 자금 사이에 **Purpose-Bound Money(PBM) 기반의 자금 집행 계층(Funds Enforcement Layer)** 을 두는 모델을 구현합니다. Agent가 어떤 결제 요청을 생성하든, 요청은 PBM 스마트 컨트랙트를 통과해야 하며 사전에 정의된 조건을 만족하지 못하면 컨트랙트 단계에서 거래가 되돌려집니다. 즉 Agent의 판단 결과가 실제 자금 이동을 결정하지 않습니다.

```
AI Agent ──결제 요청──▶ PBM 자금 집행 계층 (스마트 컨트랙트) ──조건 충족 시에만──▶ 자금 이동
                              │
                              └── 조건 위반 시 revert (자금 이동 없음)
```

## 자금 집행 계층의 검증 구조

결제는 `PBMWrapper.pay(tokenId, payee, amount, purpose)` 한 함수로 실행되며, 두 단계로 검증합니다.

| 단계 | 위치 | 검증 내용 | 위반 시 오류 |
|---|---|---|---|
| ① Agent 권한 | `PBMWrapper` | 호출자가 해당 토큰에 위임된 Agent인지 | `NotApprovedAgent` |
| ② 유효 기간 | `PBMWrapper`  | 현재 시각이 위임 만료 시각 이전인지 | `MandateExpired` |
| ③ 금액 한도 | `PBMWrapper` | 요청 금액이 1회 자율 결제 한도 이하인지 | `AutoLimitExceededError` |
| ④ 수취자 (위임 범위) | `PBMWrapper`  | 수취자가 위임 시 허용한 업체 목록에 있는지 | `VendorNotAllowedByMandate` |
| ⑤ 수취자 (PBM 정책) | `PBMLogic.canTransfer` | 수취자가 PBM 정책 화이트리스트에 있는지 | `MerchantNotWhitelisted` |
| ⑥ 예산 | `PBMLogic.canTransfer` | 요청 금액이 정책의 잔여 예산 이하인지 | `BudgetExceeded` |

모든 조건을 통과해야 토큰 잔액이 차감되고 USDC가 수취자에게 이전되며, `Payment(tokenId, payee, amount, purpose)` 이벤트로 결제 목적이 온체인에 기록됩니다. 하나라도 실패하면 거래 전체가 revert되어 자금은 이동하지 않습니다.



## 배포 정보 (Base Sepolia, chainId 84532)

| 컨트랙트 | 주소 |
|---|---|
| PBMWrapper | [`0x2B313076BB5E0CcA650E387442ac024b17d30927`](https://sepolia.basescan.org/address/0x2B313076BB5E0CcA650E387442ac024b17d30927) |
| PBMLogic | [`0xc2758aF169520424a282B1cf821251EBAAd627DE`](https://sepolia.basescan.org/address/0xc2758aF169520424a282B1cf821251EBAAd627DE) |
| PBMVault | [`0xccc3665dF3A7D32143117777eE9C28533018C472`](https://sepolia.basescan.org/address/0xccc3665dF3A7D32143117777eE9C28533018C472) |
| MockUSDC | [`0x64ae3f814b60cA79f8fc8a52dBef767fD4d65106`](https://sepolia.basescan.org/address/0x64ae3f814b60cA79f8fc8a52dBef767fD4d65106) |

## 저장소 구조

```
contracts/
  PBMWrapper.sol        자금 집행 계층 진입점 (ERC-3525 토큰, pay(), Mandate 검증)
  PBMLogic.sol          PBM 정책 (화이트리스트, 예산)
  PBMVault.sol          예치 자금 보관
  utils/MockUSDC.sol    테스트용 USDC (decimals 6)
  lib/ERC3525/          ERC-3525 (Semi-Fungible Token) 구현
test/                   컨트랙트 단위 테스트
deploy/                 배포 및 실험 스크립트 (testPay.ts 등)
scripts/                결제 조건·트랜잭션 조회 유틸리티
experiments/            실험 결과 데이터
```

## 실행 방법

요구사항: Node.js 18 이상, Yarn

```bash
yarn install
yarn compile
yarn test          # 로컬 Hardhat 네트워크에서 단위 테스트 실행
```

Base Sepolia에서 실험 시나리오를 재현하려면 `.env.example`을 `.env`로 복사하고 값을 채운 뒤 실행합니다.

```bash
cp .env.example .env
# BASE_SEPOLIA_RPC_URL, PRIVATE_KEY, AGENT_PRIVATE_KEY 등을 입력

npx hardhat run deploy/deployMock.ts --network baseSepolia       # 컨트랙트 배포 및 정책 설정
npx hardhat run deploy/deployUserFlow.ts --network baseSepolia   # 토큰 발행, Agent 위임, Mandate 등록
npx hardhat run deploy/testPay.ts --network baseSepolia          # 정상·조건 위반 결제 실행
```

테스트넷 거래에는 Base Sepolia ETH가 필요합니다. `.env`에는 개인키가 들어가므로 저장소에 커밋하지 마세요.


## 라이선스

[Apache License 2.0](LICENSE)
