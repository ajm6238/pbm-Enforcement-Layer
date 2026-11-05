/**
 * 실행:
 *   로컬 노드  hardhat run scripts/experiment/run.ts --network localhost
 *   테스트넷   hardhat run scripts/experiment/run.ts --network baseSepolia
 * 테스트넷에서는 .env의 EXP_ISSUER_PK, EXP_HOLDER_PK, EXP_AGENT_PK가 필요하다.
 * issuer 지갑만 충전하면 holder와 agent의 가스비는 스크립트가 나눠 준다.
 */
import { execSync } from "child_process";
import { ethers, network } from "hardhat";
import * as path from "path";

import { Chain, runExperiment, writeResults } from "../../experiment/core";

const AGENT_ETH = process.env.EXP_AGENT_ETH ?? "0.0008";
const HOLDER_ETH = process.env.EXP_HOLDER_ETH ?? "0.0003";

async function main() {
  const provider: any = ethers.provider;
  const { chainId } = await provider.getNetwork();
  const local = chainId === 31337;
  let actors: any;
  if (local) {
    const [issuer, holder, agent] = await ethers.getSigners();
    actors = { issuer, holder, agent };
  } else {
    const keys = ["EXP_ISSUER_PK", "EXP_HOLDER_PK", "EXP_AGENT_PK"].map(k => {
      if (!process.env[k]) throw new Error(`${k}가 .env에 없습니다.`);
      return new ethers.Wallet(process.env[k]!, provider);
    });
    actors = { issuer: keys[0], holder: keys[1], agent: keys[2] };
  }
  if (actors.holder.address === actors.agent.address) throw new Error("holder와 agent는 다른 키여야 합니다.");

  const chain = new Chain(provider, local);
  if (!local) {
    const bal = await actors.issuer.getBalance();
    console.log(`issuer ${actors.issuer.address} 잔액 ${ethers.utils.formatEther(bal)} ETH`);
    for (const [who, amt] of [
      ["holder", HOLDER_ETH],
      ["agent", AGENT_ETH],
    ] as const) {
      const want = ethers.utils.parseEther(amt);
      if ((await actors[who].getBalance()).lt(want)) {
        const o = await chain.overrides(actors.issuer, 21_000);
        await chain.must(`fund ${who}`, () =>
          actors.issuer.sendTransaction({ to: actors[who].address, value: want, ...o }),
        );
      }
    }
  }

  const ttl = Number(process.env.EXP_TTL_SECONDS ?? 300);
  const startedAt = new Date().toISOString();
  const report = await runExperiment(chain, actors, ttl, m => console.log(`[${new Date().toISOString()}] ${m}`));
  const meta = {
    network: network.name,
    chainId,
    startedAt,
    finishedAt: new Date().toISOString(),
    ttlC: ttl,
    commit: execSync("git rev-parse --short HEAD").toString().trim(),
  };
  const dir = path.join(process.cwd(), "results", `${network.name}-${startedAt.replace(/[:.]/g, "-")}`);
  writeResults(report, meta, dir);
  const fails = report.attempts.filter(a => a.verdict === "FAIL").length;
  console.log(`결과: ${dir}\n기대와 다른 시도 ${fails}건`);
  if (fails || !report.invariant.ok) process.exitCode = 1;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
