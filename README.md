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

## 실험 결과

**Base Sepolia에서 정상 결제 10건은 모두 성공하고, 조건 위반 결제 40건은 모두 차단되었습니다.**

| 시나리오 | 시도 | 결과 | 평균 gas |
|---|---:|---|---:|
| 정상 결제 | 10 | 성공 10 | 94,818 |
| 금액 초과 | 10 | 차단 10 | 49,896 |
| 수취자 위반 | 10 | 차단 10 | 47,846 |
| 유효 기간 위반 | 10 | 차단 10 | 43,756 |
| Agent 오동작, 외부 공격 | 10 | 차단 10 | 43,966 |

차단된 40건은 모두 스마트 컨트랙트에서 거부되어 자금이 이동하지 않았습니다. 같은 요청을 PBM 없이 일반 전송으로 보내면 **40건 중 37건의 자금이 그대로 이동**했습니다.

**체인에서 직접 확인하기**

- [정상 결제](https://sepolia.basescan.org/tx/0xd9e301ff9dd25423a0bba49e014690ed232f434868ec384d2826ec9d14833371)
- [금액 초과 차단](https://sepolia.basescan.org/tx/0x3f424ee847190b8de3792d861927f3843fd86fd64d0cae71eaa74ea7b355dbcf)
- [수취자 위반 차단](https://sepolia.basescan.org/tx/0x9f2b7b36f81e07438cc9d4af4a0b2e99c3f9925ae13eeb91bf1b7df10546e6d1)
- [유효 기간 위반 차단](https://sepolia.basescan.org/tx/0xdde0bd585f0bba18b1a4c2d00e289d6d0cf2b476903661d8f051acfce78cca57)
- [Agent 오동작 차단](https://sepolia.basescan.org/tx/0x014705c37e09ea386f42b7896f1fb0ecc75d69f73ad685dd02c14854df9c768f)

[전체 실험 결과와 데이터 보기](pbm-fund-control/experiments/base-sepolia-2026-11-05)

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

실험에 사용한 컨트랙트입니다.

| 컨트랙트 | 주소 |
|---|---|
| PBMWrapper | [`0x0284e13114122588D128aA167804c401bc7f5D31`](https://sepolia.basescan.org/address/0x0284e13114122588D128aA167804c401bc7f5D31) |
| PBMLogic | [`0x62BdB764cee48d3550e791603cb009086aE63275`](https://sepolia.basescan.org/address/0x62BdB764cee48d3550e791603cb009086aE63275) |
| PBMVault | [`0x3D98Bd524B6d21bdf49598F75ed92549193818E7`](https://sepolia.basescan.org/address/0x3D98Bd524B6d21bdf49598F75ed92549193818E7) |
| MockUSDC | [`0xC879a93dDE6ba3A83eBca3829b32388892166b39`](https://sepolia.basescan.org/address/0xC879a93dDE6ba3A83eBca3829b32388892166b39) |

## 저장소 구조

```
pbm-fund-control/
  contracts/
    PBMWrapper.sol        자금 집행 계층 진입점 (ERC-3525 토큰, pay(), Mandate 검증)
    PBMLogic.sol          PBM 정책 (화이트리스트, 예산)
    PBMVault.sol          예치 자금 보관
    utils/MockUSDC.sol    테스트용 USDC (decimals 6)
    lib/ERC3525/          ERC-3525 (Semi-Fungible Token) 구현
  experiment/             실험 시나리오와 판정 로직
  scripts/experiment/     실험 실행, 체인 대조 스크립트
  test/experiment/        실험 테스트
  experiments/            실험 결과 데이터
  test/                   컨트랙트 단위 테스트
  deploy/                 배포 스크립트
  scripts/                결제 조건·트랜잭션 조회 유틸리티
```

## 실행 방법

요구사항: Node.js 20, Yarn 1

```bash
cd pbm-fund-control
yarn install
cp .env.example .env
npx hardhat test test/experiment/pbm-enforcement.spec.ts test/experiment/pbm-bypass.spec.ts
```

저장된 데이터를 체인과 대조하거나 Base Sepolia에서 실험을 다시 실행하는 방법은 [실험 결과 문서](pbm-fund-control/experiments/base-sepolia-2026-11-05#재현-방법)에 있습니다.

`.env`에는 개인키가 들어가므로 저장소에 커밋하지 마세요.


## 라이선스

[Apache License 2.0](LICENSE)
