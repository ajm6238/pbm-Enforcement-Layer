# Base Sepolia 실험 결과 (2026-11-05)

Base Sepolia(chainId 84532)에 컨트랙트를 새로 배포하고, 5개 시나리오를 각 10회 실행한 결과입니다. 모든 시도는 실제 트랜잭션으로 전송했으며, 차단된 거래도 실패 트랜잭션으로 블록에 기록되어 있습니다.

| 실험 시나리오 | 시도 | 결과 | 평균 gasUsed |
|---|---:|---|---:|
| 정상 결제 | 10 | 성공 10건 | 94,818 |
| 금액 초과 | 10 | 차단 10건 | 49,896 |
| 수취자 위반 | 10 | 차단 10건 | 47,846 |
| 유효 기간 위반 | 10 | 차단 10건 | 43,756 |
| Agent 오동작, 외부 공격 | 10 | 차단 10건 | 43,966 |

- **실행 시각:** 2026-11-05 11:49~11:57 (KST)
- **블록 범위:** 54625622~54627266
- **시도별 트랜잭션:** [`attempts.csv`](attempts.csv)

## 실험 구성

| 토큰 | 예산 | 건당 한도 | 허용 벤더 | 유효 기간 | value |
|---|---:|---:|---|---|---:|
| A | 300,000 | 30,000 | M1 | 장기 | 300,000 |
| B | 10,000 | 30,000 | 없음 | 장기 | 30,000 |
| C | 300,000 | 30,000 | M1 | 300초 | 300,000 |

금액 단위는 MockUSDC입니다. 슬롯 화이트리스트에는 M1만 등록했습니다.

| 시나리오 | 내용 | 기대 오류 |
|---|---|---|
| S1 정상 결제 | 허용 수취자에게 한도 이내 20,000 결제 10건 | 없음 |
| S2 금액 초과 | Mandate 한도 초과 5건, 슬롯 예산 초과 5건 | `AutoLimitExceededError`, `BudgetExceeded` |
| S3 수취자 위반 | Mandate 벤더 목록 밖 5건, 슬롯 화이트리스트 밖 5건 | `VendorNotAllowedByMandate`, `MerchantNotWhitelisted` |
| S4 유효 기간 위반 | 토큰 C 만료 후 결제 10건 | `MandateExpired` |
| S5 Agent 오동작, 외부 공격 | 환각, 프롬프트 주입, 입력 오류를 가정한 잘못된 요청 10종을 스크립트로 전송 | `VendorNotAllowedByMandate`, `AutoLimitExceededError` |

S4는 토큰 C가 만료되기 전의 대조 결제가 성공한 것을 확인한 뒤, 실제 만료를 기다려 실행했습니다. 대조 결제는 집계에서 제외했습니다.

## 판정 기준

시도마다 트랜잭션 직전과 직후 블록의 상태를 비교했습니다.

- **차단:** 트랜잭션이 실패 상태로 블록에 기록되고, 오류가 기대값과 일치하며, 수취자 잔액, 토큰 value, 컨트랙트 USDC, `budgetUsed`의 변화가 모두 0입니다.
- **성공:** 네 값이 모두 결제 금액만큼 변하고 `Payment` 이벤트가 기록됩니다.

오류 이름은 영수증에 남지 않으므로 전송 직전 시뮬레이션으로 확보해 [`attempts.csv`](attempts.csv)의 `preflightError`에 기록했습니다. 체인에서 직접 확인되는 값은 실패 상태와 잔액 무변화입니다.

실험 종료 시 컨트랙트 USDC 410,000과 토큰 value 합계 410,000이 일치했습니다(대조군 실행 전 기준).

## 대조군

같은 위반 요청 40건을 PBM 없이 일반 USDC 전송으로 보내면 **37건의 자금이 이동**했습니다. 나머지 3건은 정책이 아닌 다른 이유로 실패했습니다.

| 요청 | 실패 이유 |
|---|---|
| S5-03 소수 자릿수 착오 | 지갑 잔액 부족 |
| S5-07 제로 주소 결제 | ERC-20의 제로 주소 전송 거부 |
| S5-10 uint256 최댓값 | 지갑 잔액 부족 |

## 체인 대조

저장된 데이터를 실험 스크립트와 다른 RPC로 다시 조회해 대조했습니다. 결과는 [`logs/chain-verification.log`](logs/chain-verification.log)에 있습니다.

| 항목 | 결과 |
|---|---|
| 시도 51건(대조 결제 포함)의 상태, gasUsed, 발신자, 수신 컨트랙트 | 불일치 0건 |
| 차단 40건의 이벤트 로그 | 모두 없음 |
| 유효 기간 위반 10건의 블록 시각 | 모두 만료 시각 이후 |
| 대조군 40건의 상태, gasUsed | 불일치 0건 |
| 배포 바이트코드와 이 저장소 소스의 빌드 결과 | 4개 컨트랙트 일치(메타데이터 해시와 불변값 제외) |

## 배포 정보

| 컨트랙트 | 주소 |
|---|---|
| PBMWrapper | [`0x0284e13114122588D128aA167804c401bc7f5D31`](https://sepolia.basescan.org/address/0x0284e13114122588D128aA167804c401bc7f5D31) |
| PBMLogic | [`0x62BdB764cee48d3550e791603cb009086aE63275`](https://sepolia.basescan.org/address/0x62BdB764cee48d3550e791603cb009086aE63275) |
| PBMVault | [`0x3D98Bd524B6d21bdf49598F75ed92549193818E7`](https://sepolia.basescan.org/address/0x3D98Bd524B6d21bdf49598F75ed92549193818E7) |
| MockUSDC | [`0xC879a93dDE6ba3A83eBca3829b32388892166b39`](https://sepolia.basescan.org/address/0xC879a93dDE6ba3A83eBca3829b32388892166b39) |

| 역할 | 주소 |
|---|---|
| 발행자 | `0x462946D7e09F876a05F3281c772c192d59d8a43A` |
| 사용자(토큰 소유자) | `0x4B72A6DC58d7AA02Cf693a198Ba7697E956bFEEd` |
| Agent | `0x0c9bF0AAEa4af29C85E2b3098e622895EaAb8AaB` |
| 수취자 M1 | `0xd9b03676012A9a8FBcC89811262192Dfb2DF5B86` |

## 사용한 코드

컨트랙트 소스는 이 저장소의 커밋 [`74596c4`](https://github.com/ajm6238/pbm-Enforcement-Layer/tree/74596c4250f60296d4105e999277df416c5ed075)와 같습니다(줄바꿈 제외). `meta.json`과 `summary.md`의 `b3c5267`은 실험 당시 로컬 작업 사본의 커밋입니다.

## 파일

| 파일 | 내용 |
|---|---|
| [`summary.md`](summary.md) | 스크립트가 만든 요약 |
| [`attempts.csv`](attempts.csv), [`attempts.json`](attempts.json) | 시도별 트랜잭션 해시, 오류, 잔액 변화, 판정 |
| [`control.csv`](control.csv) | 대조군 트랜잭션 |
| [`meta.json`](meta.json) | 배포 주소, 지갑, 토큰, 실행 시각 |
| [`logs/run.log`](logs/run.log) | 실행 로그 |
| [`logs/chain-verification.log`](logs/chain-verification.log) | 체인 대조 결과 |
| [`logs/experiment-tests.log`](logs/experiment-tests.log) | 실험 테스트 실행 결과 |

## 재현 방법

요구사항은 Node.js 20, Yarn 1입니다. 아래 명령은 `pbm-fund-control` 폴더에서 실행합니다.

**로컬 테스트**

```bash
yarn install
cp .env.example .env
npx hardhat test test/experiment/pbm-enforcement.spec.ts test/experiment/pbm-bypass.spec.ts
```

**저장된 데이터를 체인과 대조**

```bash
npx hardhat run scripts/experiment/verifyChain.ts --network baseSepolia
```

**Base Sepolia에서 다시 실행**

`.env`의 `EXP_ISSUER_PK`, `EXP_HOLDER_PK`, `EXP_AGENT_PK`에 테스트넷 전용 지갑의 키를 넣고, 발행자 지갑에 Base Sepolia ETH를 0.002 ETH 이상 넣습니다. 이번 실행의 비용은 트랜잭션 111건, 약 0.00007 ETH였습니다. 컨트랙트 4개를 새로 배포하고, 결과는 `results/`에 저장됩니다.

```bash
npx hardhat run scripts/experiment/run.ts --network baseSepolia
```
