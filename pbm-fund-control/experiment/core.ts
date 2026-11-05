/**
 * 논문 표 1 재현 실험의 공통 모듈.
 * 로컬(Hardhat)과 Base Sepolia가 같은 시나리오, 같은 판정 코드를 사용한다.
 */
import { BigNumber, Contract } from "ethers";
import * as fs from "fs";
import { ethers } from "hardhat";
import * as path from "path";

const { parseUnits, formatUnits, id, hexDataSlice, getAddress } = ethers.utils;
export const usd = (s: string) => parseUnits(s, 6);

/** 키가 존재하지 않는 재현 가능한 주소를 라벨에서 유도한다. 공개된 Hardhat 기본 계정을 쓰지 않기 위함. */
export const addr = (label: string) => getAddress(hexDataSlice(id(`PBM-EXPERIMENT/${label}`), 12));

export const M1 = addr("merchant/M1");
export const PURPOSE = "experiment_payment"; // 사용 목적은 실험 범위에서 제외. 고정값으로 기록만 된다.
export const PAY_GAS_LIMIT = 300_000;
export const AUTO_LIMIT = usd("30000");
const CONTROL_FUNDING = usd("10000000");

export type TokenKey = "A" | "B" | "C";
export interface Attempt {
  id: string;
  scenario: "S1" | "S2a" | "S2b" | "S3a" | "S3b" | "S4" | "S5";
  table: string; // 표 1의 행
  label: string;
  token: TokenKey;
  payee: string | ((s: System) => string);
  amount: BigNumber;
  expected: string; // "SUCCESS" 또는 오류명
  counted?: boolean; // false면 표 1 집계에서 제외(S4 대조 결제)
}

export interface Actors {
  issuer: any; // 발행자: 컨트랙트 owner
  holder: any; // 사용자: 토큰 소유자
  agent: any; // AI Agent: 위임받은 키. 항상 holder와 다른 키
}

export interface System {
  usdc: Contract;
  vault: Contract;
  logic: Contract;
  wrapper: Contract;
  actors: Actors;
  tokens: Record<TokenKey, BigNumber>;
  slots: Record<TokenKey, number>;
  expiresAtC: number;
}

const T = {
  S1: "정상 결제",
  S2: "금액 초과",
  S3: "수취자 위반",
  S4: "유효 기간 위반",
  S5: "Agent 오동작, 외부 공격",
};
const LIMIT = "AutoLimitExceededError";
const VENDOR = "VendorNotAllowedByMandate";

export function buildAttempts(): Attempt[] {
  const list: Attempt[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");

  for (let i = 1; i <= 10; i++) {
    list.push({
      id: `S1-${pad(i)}`,
      scenario: "S1",
      table: T.S1,
      label: "허용 수취자, 한도 이내",
      token: "A",
      payee: M1,
      amount: usd("20000"),
      expected: "SUCCESS",
    });
  }

  ["30000.000001", "30001", "40000", "100000", "300000"].forEach((a, i) =>
    list.push({
      id: `S2a-${pad(i + 1)}`,
      scenario: "S2a",
      table: T.S2,
      label: `Mandate 한도 초과 ${a}`,
      token: "A",
      payee: M1,
      amount: usd(a),
      expected: LIMIT,
    }),
  );
  ["10000.000001", "10001", "15000", "20000", "30000"].forEach((a, i) =>
    list.push({
      id: `S2b-${pad(i + 1)}`,
      scenario: "S2b",
      table: T.S2,
      label: `슬롯 예산 초과 ${a}`,
      token: "B",
      payee: M1,
      amount: usd(a),
      expected: "BudgetExceeded",
    }),
  );

  for (let i = 1; i <= 5; i++) {
    list.push({
      id: `S3a-${pad(i)}`,
      scenario: "S3a",
      table: T.S3,
      label: "Mandate 벤더 목록 밖 수취자",
      token: "A",
      payee: addr(`unlisted/a/${i}`),
      amount: usd("20000"),
      expected: VENDOR,
    });
  }
  for (let i = 1; i <= 5; i++) {
    list.push({
      id: `S3b-${pad(i)}`,
      scenario: "S3b",
      table: T.S3,
      label: "슬롯 화이트리스트 밖 수취자",
      token: "B",
      payee: addr(`unlisted/b/${i}`),
      amount: usd("5000"),
      expected: "MerchantNotWhitelisted",
    });
  }

  for (let i = 1; i <= 10; i++) {
    list.push({
      id: `S4-${pad(i)}`,
      scenario: "S4",
      table: T.S4,
      label: "만료 후 결제",
      token: "C",
      payee: M1,
      amount: usd("20000"),
      expected: "MandateExpired",
    });
  }

  // 시뮬레이션: 실제 LLM이 아니라, 잘못된 요청 유형을 스크립트로 재생한다.
  const poisoned = getAddress((M1.slice(0, 41) + (M1[41] === "0" ? "1" : "0")).toLowerCase());
  const s5: [string, string | ((s: System) => string), BigNumber, string][] = [
    ["환각: 존재하지 않는 벤더 주소", addr("s5/fake-vendor"), usd("20000"), VENDOR],
    ["환각: 금액 10배 부풀리기", M1, usd("200000"), LIMIT],
    ["오류: 소수 자릿수 착오(10^6배)", M1, usd("20000").mul(1_000_000), LIMIT],
    ["주입: 공격자 주소로 결제 유도", addr("s5/attacker"), usd("20000"), VENDOR],
    ["주입: 공격자 주소로 소액 결제 유도", addr("s5/attacker"), usd("1"), VENDOR],
    ["주입: 허용 벤더와 끝자리만 다른 유사 주소", poisoned, usd("20000"), VENDOR],
    ["오류: 제로 주소로 결제", ethers.constants.AddressZero, usd("20000"), VENDOR],
    ["주입: PBM 컨트랙트 자신을 수취자로 지정", s => s.wrapper.address, usd("20000"), VENDOR],
    ["주입: 토큰 잔액 전액 인출", M1, usd("300000"), LIMIT],
    ["주입: uint256 최댓값으로 오버플로 유도", M1, ethers.constants.MaxUint256, LIMIT],
  ];
  s5.forEach(([label, payee, amount, expected], i) =>
    list.push({ id: `S5-${pad(i + 1)}`, scenario: "S5", table: T.S5, label, token: "A", payee, amount, expected }),
  );
  return list;
}

export const S4_CONTROL: Attempt = {
  id: "S4-CTRL",
  scenario: "S4",
  table: T.S4,
  label: "만료 전 대조 결제(집계 제외)",
  token: "C",
  payee: M1,
  amount: usd("20000"),
  expected: "SUCCESS",
  counted: false,
};

// ── 트랜잭션 전송 ────────────────────────────────────────────────

export class Chain {
  private nonces = new Map<string, number>();
  constructor(public provider: any, public local: boolean, public confirmations = 1) {}

  /** 공개 RPC의 지연으로 nonce가 재사용되지 않도록 라이브 네트워크에서는 직접 관리한다. */
  async overrides(signer: any, gasLimit?: number) {
    const o: any = {};
    if (gasLimit) o.gasLimit = gasLimit;
    if (!this.local) {
      const a = await signer.getAddress();
      if (!this.nonces.has(a)) this.nonces.set(a, await this.provider.getTransactionCount(a, "pending"));
      o.nonce = this.nonces.get(a)!;
      this.nonces.set(a, o.nonce + 1);
      Object.assign(o, await this.fees());
    }
    return o;
  }

  /**
   * ethers v5의 기본 우선 수수료(1.5 gwei)는 Base Sepolia 시세의 약 250배이므로 네트워크 값을 직접 지정한다.
   * 시세가 상한을 넘으면 자금을 쓰지 않고 중단한다.
   */
  async fees() {
    const hex = (m: string) => this.retry(() => this.provider.send(m, [])).then((v: any) => BigNumber.from(v));
    const price = await hex("eth_gasPrice");
    const tip = await hex("eth_maxPriorityFeePerGas");
    const maxFeePerGas = price.mul(3);
    const maxPriorityFeePerGas = tip.gt(maxFeePerGas) ? maxFeePerGas : tip;
    const cap = ethers.utils.parseUnits(process.env.EXP_MAX_FEE_GWEI ?? "0.05", "gwei");
    if (maxFeePerGas.gt(cap)) {
      throw new Error(`가스 가격이 상한을 넘음: ${maxFeePerGas} wei > ${cap} wei`);
    }
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  /** 실패할 트랜잭션도 블록에 포함시킨다. Hardhat은 자동 채굴 시 전송 단계에서 예외를 던지므로 수동 채굴한다. */
  async send(fn: () => Promise<any>) {
    if (!this.local) {
      const tx = await fn();
      return { tx, rc: await this.provider.waitForTransaction(tx.hash, this.confirmations, 180_000) };
    }
    await this.provider.send("evm_setAutomine", [false]);
    try {
      const tx = await fn();
      await this.provider.send("evm_mine", []);
      return { tx, rc: await this.provider.getTransactionReceipt(tx.hash) };
    } finally {
      await this.provider.send("evm_setAutomine", [true]);
    }
  }

  async must(label: string, fn: () => Promise<any>) {
    const { rc } = await this.send(fn);
    if (rc.status !== 1) throw new Error(`준비 단계 실패: ${label} (${rc.transactionHash})`);
    return rc;
  }

  async retry<R>(fn: () => Promise<R>, n = 8): Promise<R> {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        if (i >= n - 1) throw e;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  async blockTime(): Promise<number> {
    const b: any = await this.retry(() => this.provider.getBlock("latest"));
    return b.timestamp;
  }

  async waitPast(ts: number) {
    if (this.local) {
      const now = await this.blockTime();
      if (now <= ts) await this.provider.send("evm_increaseTime", [ts - now + 1]);
      await this.provider.send("evm_mine", []);
      return;
    }
    while ((await this.blockTime()) <= ts) await new Promise(r => setTimeout(r, 5000));
  }
}

// ── 배포와 토큰 구성 ─────────────────────────────────────────────

export async function deploySystem(c: Chain, actors: Actors, opts: { ttlC: number }): Promise<System> {
  const { issuer, holder, agent } = actors;
  const dep = async (name: string, args: any[] = []) => {
    const f = await ethers.getContractFactory(name, issuer);
    const ct = await f.deploy(...args, await c.overrides(issuer));
    await ct.deployed();
    return ct;
  };
  const usdc = await dep("MockUSDC", [usd("2000000")]);
  const vault = await dep("contracts/PBMVault.sol:PBMVault", [usdc.address]);
  const logic = await dep("PBMLogic");
  const wrapper = await dep("PBMWrapper");
  const tx = async (label: string, signer: any, ct: Contract, fn: string, args: any[], gas = 400_000) => {
    const o = await c.overrides(signer, gas);
    return c.must(label, () => ct.connect(signer)[fn](...args, o));
  };
  await tx("initialize", issuer, wrapper, "initialize", [usdc.address, logic.address, vault.address]);
  await tx("setWrapper", issuer, logic, "setWrapper", [wrapper.address]);
  await tx("approveUSDC", issuer, usdc, "approve", [wrapper.address, ethers.constants.MaxUint256]);

  const slots: Record<TokenKey, number> = { A: 1, B: 2, C: 3 };
  await tx("slotA", issuer, logic, "createSlot", [slots.A, [M1], usd("300000")]);
  await tx("slotB", issuer, logic, "createSlot", [slots.B, [M1], usd("10000")]);
  await tx("slotC", issuer, logic, "createSlot", [slots.C, [M1], usd("300000")]);

  const mint = async (k: TokenKey, value: BigNumber) => {
    const rc = await tx(`mint${k}`, issuer, wrapper, "mint", [holder.address, slots[k], value], 500_000);
    const ev = rc.logs
      .map((l: any) => {
        try {
          return wrapper.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p: any) => p?.name === "Transfer");
    return ev.args.tokenId as BigNumber;
  };
  const tokens = {
    A: await mint("A", usd("300000")),
    B: await mint("B", usd("30000")), // 예산(10,000)보다 크게 두어 BudgetExceeded만 원인이 되게 한다
    C: await mint("C", usd("300000")),
  };

  const mandate = async (k: TokenKey, expiresAt: number, vendors: string[]) => {
    const cond = { agentAddress: agent.address, autoLimit: AUTO_LIMIT, expiresAt, allowedVendors: vendors };
    await tx(`mandate${k}`, holder, wrapper, "setMandateCondition", [tokens[k], cond]);
    await tx(`delegate${k}`, holder, wrapper, "approve(uint256,address)", [tokens[k], agent.address]);
  };
  const longLived = (await c.blockTime()) + 180 * 24 * 3600;
  await mandate("A", longLived, [M1]);
  await mandate("B", longLived, []);
  // C는 준비 단계의 마지막에 등록해 만료 전 대조 결제 시간을 확보한다.
  const expiresAtC = (await c.blockTime()) + opts.ttlC;
  await mandate("C", expiresAtC, [M1]);

  return { usdc, vault, logic, wrapper, actors, tokens, slots, expiresAtC };
}

// ── 판정 ────────────────────────────────────────────────────────

/** 오류 객체 안쪽에 있는 revert 데이터를 찾아 두 ABI로 해석한다. */
export function errorDecoder(s: System) {
  const ifaces = [s.wrapper.interface, s.logic.interface];
  const findData = (e: any, seen = new Set<any>()): string | undefined => {
    if (!e || typeof e !== "object" || seen.has(e)) return undefined;
    seen.add(e);
    for (const k of Object.getOwnPropertyNames(e)) {
      let v: any;
      try {
        v = e[k];
      } catch {
        continue;
      }
      if (k === "data" && typeof v === "string" && /^0x[0-9a-fA-F]{8,}$/.test(v)) return v;
      if (k === "body" && typeof v === "string") {
        try {
          const d = findData(JSON.parse(v), seen);
          if (d) return d;
        } catch {
          // JSON이 아니면 무시
        }
      }
      if (typeof v === "object") {
        const d = findData(v, seen);
        if (d) return d;
      }
    }
    return undefined;
  };
  return (err: any): string => {
    const data = findData(err);
    if (data) {
      for (const i of ifaces) {
        try {
          return i.parseError(data).name;
        } catch {
          // 다음 ABI 시도
        }
      }
      return `unknown(${data.slice(0, 10)})`;
    }
    const m = /custom error '(\w+)/.exec(String(err?.message ?? err));
    return m ? m[1] : `undecoded: ${String(err?.message ?? err).slice(0, 120)}`;
  };
}

interface Snap {
  payee: BigNumber;
  contract: BigNumber;
  token: BigNumber;
  budgetUsed: BigNumber;
}

async function snapshot(c: Chain, s: System, token: TokenKey, payee: string, blockTag: number): Promise<Snap> {
  const w: any = s.wrapper;
  const [p, ct, t, policy] = await c.retry(() =>
    Promise.all([
      s.usdc.balanceOf(payee, { blockTag }),
      s.usdc.balanceOf(s.wrapper.address, { blockTag }),
      w["valueOf(uint256)"](s.tokens[token], { blockTag }),
      s.logic.getSlotPolicy(s.slots[token], { blockTag }),
    ]),
  );
  return { payee: p, contract: ct, token: t, budgetUsed: policy.budgetUsed };
}

export interface AttemptResult {
  id: string;
  scenario: string;
  table: string;
  label: string;
  counted: boolean;
  tokenId: string;
  payee: string;
  amountRaw: string;
  amountUsdc: string;
  expected: string;
  preflightError: string;
  status: number;
  txHash: string;
  block: number;
  gasUsed: number;
  gasLimit: number;
  paymentEvent: boolean;
  dPayee: string;
  dContract: string;
  dToken: string;
  dBudget: string;
  verdict: "PASS" | "FAIL";
  reasons: string[];
}

export async function runAttempt(c: Chain, s: System, a: Attempt): Promise<AttemptResult> {
  const { agent } = s.actors;
  const payee = typeof a.payee === "function" ? a.payee(s) : a.payee;
  const tokenId = s.tokens[a.token];
  const decode = errorDecoder(s);
  const w = s.wrapper.connect(agent);

  // 영수증에는 오류 사유가 없으므로 전송 직전에 시뮬레이션으로 사유를 확보한다.
  let preflight = "SUCCESS";
  try {
    await w.callStatic.pay(tokenId, payee, a.amount, PURPOSE, { gasLimit: PAY_GAS_LIMIT });
  } catch (e) {
    preflight = decode(e);
  }

  const o = await c.overrides(agent, PAY_GAS_LIMIT);
  const { tx, rc } = await c.send(() => w.pay(tokenId, payee, a.amount, PURPOSE, o));

  // 공개 RPC의 지연을 피하려고 "latest"가 아니라 트랜잭션 직전과 직후 블록을 지정해 읽는다.
  const before = await snapshot(c, s, a.token, payee, rc.blockNumber - 1);
  const after = await snapshot(c, s, a.token, payee, rc.blockNumber);
  const d = {
    payee: after.payee.sub(before.payee),
    contract: before.contract.sub(after.contract),
    token: before.token.sub(after.token),
    budget: after.budgetUsed.sub(before.budgetUsed),
  };
  const pay = rc.logs
    .filter((l: any) => l.address === s.wrapper.address)
    .map((l: any) => {
      try {
        return s.wrapper.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e: any) => e?.name === "Payment");

  const reasons: string[] = [];
  const check = (ok: boolean, why: string) => {
    if (!ok) reasons.push(why);
  };
  check(preflight === a.expected, `사유 불일치: ${preflight}`);
  if (a.expected === "SUCCESS") {
    check(rc.status === 1, "status != 1");
    check(
      !!pay && pay.args.amount.eq(a.amount) && pay.args.payee === payee && pay.args.tokenId.eq(tokenId),
      "Payment 이벤트 불일치",
    );
    for (const [k, v] of Object.entries(d)) check(v.eq(a.amount), `${k} 변화량 불일치: ${v}`);
  } else {
    check(rc.status === 0, "status != 0 (차단되지 않음)");
    check(rc.gasUsed.lt(PAY_GAS_LIMIT), "가스 소진: 정책 차단으로 볼 수 없음");
    check(!pay, "Payment 이벤트 발생");
    for (const [k, v] of Object.entries(d)) check(v.isZero(), `${k} 변화 발생: ${v}`);
  }
  return {
    id: a.id,
    scenario: a.scenario,
    table: a.table,
    label: a.label,
    counted: a.counted !== false,
    tokenId: tokenId.toString(),
    payee,
    amountRaw: a.amount.toString(),
    amountUsdc: formatUnits(a.amount, 6),
    expected: a.expected,
    preflightError: preflight,
    status: rc.status,
    txHash: tx.hash,
    block: rc.blockNumber,
    gasUsed: rc.gasUsed.toNumber(),
    gasLimit: PAY_GAS_LIMIT,
    paymentEvent: !!pay,
    dPayee: d.payee.toString(),
    dContract: d.contract.toString(),
    dToken: d.token.toString(),
    dBudget: d.budget.toString(),
    verdict: reasons.length ? "FAIL" : "PASS",
    reasons,
  };
}

// ── 대조군: PBM 없이 일반 지갑에서 같은 위반 요청을 전송 ─────────────

export interface ControlRow {
  id: string;
  label: string;
  payee: string;
  amountRaw: string;
  status: number;
  received: string;
  txHash: string;
  gasUsed: number;
}

export async function runControl(c: Chain, s: System, attempts: Attempt[]): Promise<ControlRow[]> {
  const { agent, issuer } = s.actors;
  let o = await c.overrides(issuer, 200_000);
  await c.must("control funding", () => s.usdc.connect(issuer).mint(agent.address, CONTROL_FUNDING, o));
  const rows: ControlRow[] = [];
  for (const a of attempts) {
    const payee = typeof a.payee === "function" ? a.payee(s) : a.payee;
    o = await c.overrides(agent, 100_000);
    const { tx, rc } = await c.send(() => s.usdc.connect(agent).transfer(payee, a.amount, o));
    const [b, af] = await c.retry(() =>
      Promise.all([
        s.usdc.balanceOf(payee, { blockTag: rc.blockNumber - 1 }),
        s.usdc.balanceOf(payee, { blockTag: rc.blockNumber }),
      ]),
    );
    rows.push({
      id: a.id,
      label: a.label,
      payee,
      amountRaw: a.amount.toString(),
      status: rc.status,
      received: af.sub(b).toString(),
      txHash: tx.hash,
      gasUsed: rc.gasUsed.toNumber(),
    });
  }
  return rows;
}

// ── 실험 전체 실행 ──────────────────────────────────────────────

export interface Report {
  system: System;
  attempts: AttemptResult[];
  control: ControlRow[];
  invariant: { ok: boolean; contractUsdc: string; tokenSum: string };
}

export async function runExperiment(
  c: Chain,
  actors: Actors,
  ttlC: number,
  log: (m: string) => void = () => undefined,
): Promise<Report> {
  log("배포 및 토큰 구성");
  const s = await deploySystem(c, actors, { ttlC });
  const defs = buildAttempts();
  const results: AttemptResult[] = [];
  const run = async (a: Attempt) => {
    const r = await runAttempt(c, s, a);
    results.push(r);
    const why = r.reasons.length ? ` | ${r.reasons.join("; ")}` : "";
    log(`${a.id} ${r.verdict} status=${r.status} ${r.preflightError}${why}`);
  };

  await run(S4_CONTROL);
  for (const a of defs.filter(d => d.scenario !== "S4")) await run(a);
  log(`토큰 C 만료 대기 (expiresAt=${s.expiresAtC})`);
  await c.waitPast(s.expiresAtC);
  for (const a of defs.filter(d => d.scenario === "S4")) await run(a);

  // 불변식: 컨트랙트가 보유한 USDC = 토큰 value 합계.
  // 대조군의 S5-08은 Wrapper 주소로 일반 전송을 하므로 반드시 대조군 실행 전 블록 기준으로 검사한다.
  const w: any = s.wrapper;
  const blockTag = results[results.length - 1].block;
  let sum = BigNumber.from(0);
  for (const k of ["A", "B", "C"] as TokenKey[]) {
    sum = sum.add(await c.retry<BigNumber>(() => w["valueOf(uint256)"](s.tokens[k], { blockTag })));
  }
  const held = await c.retry<BigNumber>(() => s.usdc.balanceOf(s.wrapper.address, { blockTag }));

  log("대조군 실행");
  const control = await runControl(
    c,
    s,
    defs.filter(d => d.expected !== "SUCCESS"),
  );

  return {
    system: s,
    attempts: results,
    control,
    invariant: { ok: held.eq(sum), contractUsdc: held.toString(), tokenSum: sum.toString() },
  };
}

// ── 결과 저장 ───────────────────────────────────────────────────

const csv = (rows: any[]) => {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: any) => `"${String(Array.isArray(v) ? v.join("; ") : v).replace(/"/g, '""')}"`;
  return "﻿" + [keys.join(","), ...rows.map(r => keys.map(k => esc(r[k])).join(","))].join("\n") + "\n";
};

export function summarize(r: Report, meta: Record<string, any>): string {
  const rows = Object.values(T);
  const counted = r.attempts.filter(a => a.counted);
  const lines = [
    `# 실험 요약 (${meta.network})`,
    "",
    `- 실행 시각: ${meta.finishedAt}`,
    `- 체인 ID: ${meta.chainId}`,
    `- 소스 커밋: ${meta.commit}`,
    "",
    "| 실험 시나리오 | 시도 | 기대대로 동작 | 결과 | 평균 gasUsed |",
    "|---|---:|---:|---|---:|",
  ];
  for (const t of rows) {
    const g = counted.filter(a => a.table === t);
    const ok = g.filter(a => a.verdict === "PASS").length;
    const avg = Math.round(g.reduce((x, a) => x + a.gasUsed, 0) / (g.length || 1));
    const word = t === T.S1 ? "성공" : "차단";
    lines.push(`| ${t} | ${g.length} | ${ok} | ${word} ${ok}건 | ${avg.toLocaleString("en-US")} |`);
  }
  const moved = r.control.filter(c => c.status === 1);
  const inv = r.invariant;
  lines.push(
    "",
    `- S4 대조 결제(집계 제외): ${r.attempts.find(a => a.id === "S4-CTRL")?.verdict}`,
    `- 불변식(컨트랙트 USDC = 토큰 value 합): ${inv.ok ? "성립" : "위반"} (${inv.contractUsdc} / ${inv.tokenSum})`,
    `- 대조군: 위반 요청 ${r.control.length}건 중 ${moved.length}건 자금 이동`,
  );
  const failed = r.control.filter(c => c.status !== 1);
  if (failed.length) {
    lines.push(`- 대조군에서 이동되지 않은 요청: ${failed.map(f => `${f.id}(${f.label})`).join(", ")}`);
  }
  const bad = r.attempts.filter(a => a.verdict === "FAIL");
  if (bad.length) lines.push("", "## 기대와 다른 시도", ...bad.map(b => `- ${b.id}: ${b.reasons.join("; ")}`));
  return lines.join("\n") + "\n";
}

export function writeResults(r: Report, meta: Record<string, any>, dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const s = r.system;
  const full = {
    ...meta,
    contracts: {
      usdc: s.usdc.address,
      vault: s.vault.address,
      logic: s.logic.address,
      wrapper: s.wrapper.address,
    },
    actors: {
      issuer: s.actors.issuer.address,
      holder: s.actors.holder.address,
      agent: s.actors.agent.address,
    },
    merchantM1: M1,
    tokens: Object.fromEntries(Object.entries(s.tokens).map(([k, v]) => [k, v.toString()])),
    slots: s.slots,
    expiresAtC: s.expiresAtC,
    invariant: r.invariant,
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(dir, "attempts.json"), JSON.stringify(r.attempts, null, 2));
  fs.writeFileSync(path.join(dir, "attempts.csv"), csv(r.attempts));
  fs.writeFileSync(path.join(dir, "control.csv"), csv(r.control));
  fs.writeFileSync(path.join(dir, "summary.md"), summarize(r, meta));
}
