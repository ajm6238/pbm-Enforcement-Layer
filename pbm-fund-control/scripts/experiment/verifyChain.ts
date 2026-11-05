/**
 * 저장된 실험 데이터를 체인 기록과 대조한다. 읽기 전용이며 트랜잭션을 보내지 않는다.
 *
 * RESULT_DIR=experiments/base-sepolia-2026-11-05 \
 *   npx hardhat run scripts/experiment/verifyChain.ts --network baseSepolia
 */
import * as fs from "fs";
import { artifacts, ethers } from "hardhat";
import * as path from "path";

const DIR = path.resolve(process.env.RESULT_DIR ?? "experiments/base-sepolia-2026-11-05");

type Attempt = {
  id: string;
  scenario: string;
  counted: boolean;
  expected: string;
  status: number;
  txHash: string;
  gasUsed: number;
};

const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));

async function retry<T>(fn: () => Promise<T>, times = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= times - 1) throw e;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

const receipt = (hash: string) => retry(() => ethers.provider.getTransactionReceipt(hash));
const blockTime = async (n: number) => (await retry(() => ethers.provider.getBlock(n))).timestamp;

/** 끝의 메타데이터 해시를 지우고 배포 시 채워지는 불변값 위치를 0으로 맞춘다. */
function normalize(code: string, refs: Record<string, { start: number; length: number }[]>) {
  const bytes = code.slice(2);
  const metaLen = parseInt(bytes.slice(-4), 16);
  let body = bytes.slice(0, bytes.length - (metaLen + 2) * 2);
  for (const list of Object.values(refs)) {
    for (const { start, length } of list) {
      body = body.slice(0, start * 2) + "0".repeat(length * 2) + body.slice((start + length) * 2);
    }
  }
  return body;
}

async function verifyBytecode(name: string, fqn: string, address: string) {
  const [source, contract] = fqn.split(":");
  const build = await artifacts.getBuildInfo(fqn);
  const output = build!.output.contracts[source][contract] as any;
  const compiled = "0x" + output.evm.deployedBytecode.object;
  const refs = output.evm.deployedBytecode.immutableReferences ?? {};
  const deployed = await retry(() => ethers.provider.getCode(address));
  return { name, same: normalize(deployed, refs) === normalize(compiled, refs) };
}

async function main() {
  const meta = readJson("meta.json");
  const attempts: Attempt[] = readJson("attempts.json");
  let mismatches = 0;
  const fail = (msg: string) => {
    mismatches++;
    console.log(`불일치: ${msg}`);
  };

  const scenarios = new Map<string, { n: number; success: number; gas: number; noLogs: number }>();
  const expiredTimes: number[] = [];
  for (const a of attempts) {
    const rc = await receipt(a.txHash);
    if (!rc) {
      fail(`${a.id} 영수증 없음`);
      continue;
    }
    if (rc.status !== a.status) fail(`${a.id} status ${rc.status} != ${a.status}`);
    if ((rc.status === 1) !== (a.expected === "SUCCESS")) fail(`${a.id} 기대 결과와 다름`);
    if (rc.gasUsed.toNumber() !== a.gasUsed) fail(`${a.id} gasUsed ${rc.gasUsed} != ${a.gasUsed}`);
    if (rc.from !== meta.actors.agent) fail(`${a.id} 발신자 ${rc.from}`);
    if (rc.to !== meta.contracts.wrapper) fail(`${a.id} 수신 컨트랙트 ${rc.to}`);
    if (rc.status === 0 && rc.logs.length !== 0) fail(`${a.id} 실패 거래에 이벤트 있음`);
    if (!a.counted) continue;

    const key = a.scenario.replace(/[ab]$/, "");
    const s = scenarios.get(key) ?? { n: 0, success: 0, gas: 0, noLogs: 0 };
    s.n++;
    s.success += rc.status;
    s.gas += rc.gasUsed.toNumber();
    s.noLogs += rc.logs.length === 0 ? 1 : 0;
    scenarios.set(key, s);
    if (key === "S4") expiredTimes.push(await blockTime(rc.blockNumber));
  }
  console.log(`시도 ${attempts.length}건 대조 완료`);
  for (const [key, s] of [...scenarios].sort()) {
    console.log(`${key}: ${s.n}건, 성공 ${s.success}, 이벤트 없음 ${s.noLogs}, 평균 gasUsed ${Math.round(s.gas / s.n)}`);
  }

  if (expiredTimes.length !== 10 || expiredTimes.some(t => t < meta.expiresAtC)) fail("S4 만료 시각");
  console.log(
    `S4: 만료 시각 ${meta.expiresAtC}, 블록 시각 ${Math.min(...expiredTimes)}~${Math.max(...expiredTimes)}`,
  );

  const rows = fs.readFileSync(path.join(DIR, "control.csv"), "utf8").trim().split(/\r?\n/).slice(1);
  const reverted: string[] = [];
  let controlSuccess = 0;
  for (const row of rows) {
    const id = row.split(",")[0].replace(/"/g, "");
    const hash = row.match(/0x[0-9a-fA-F]{64}/)?.[0];
    const gas = row.split(",").pop()!.replace(/"/g, "");
    if (!hash) {
      reverted.push(id);
      continue;
    }
    const rc = await receipt(hash);
    if (!rc || rc.gasUsed.toString() !== gas) fail(`대조군 ${id}`);
    else if (rc.status === 1) controlSuccess++;
    else reverted.push(id);
  }
  console.log(`대조군: ${rows.length}건, 자금 이동 ${controlSuccess}, 미이동 ${reverted.join(", ")}`);
  if (rows.length !== 40 || controlSuccess !== 37) fail("대조군 건수");

  const contracts: [string, string, string][] = [
    ["MockUSDC", "contracts/utils/MockUSDC.sol:MockUSDC", meta.contracts.usdc],
    ["PBMVault", "contracts/PBMVault.sol:PBMVault", meta.contracts.vault],
    ["PBMLogic", "contracts/PBMLogic.sol:PBMLogic", meta.contracts.logic],
    ["PBMWrapper", "contracts/PBMWrapper.sol:PBMWrapper", meta.contracts.wrapper],
  ];
  for (const [name, fqn, address] of contracts) {
    const r = await verifyBytecode(name, fqn, address);
    console.log(`바이트코드 ${r.name}: ${r.same ? "일치" : "불일치"}`);
    if (!r.same) fail(`${r.name} 바이트코드`);
  }

  console.log(`결과: 불일치 ${mismatches}건`);
  process.exitCode = mismatches ? 1 : 0;
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
