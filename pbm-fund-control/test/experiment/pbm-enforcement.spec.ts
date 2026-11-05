import { expect } from "chai";
import { ethers, network } from "hardhat";
import * as path from "path";

import { Chain, Report, buildAttempts, runExperiment, writeResults } from "../../experiment/core";

describe("표 1 재현 (로컬)", function () {
  this.timeout(300_000);
  let report: Report;
  const defs = buildAttempts();

  before(async function () {
    const [issuer, holder, agent] = await ethers.getSigners();
    report = await runExperiment(new Chain(ethers.provider, true), { issuer, holder, agent }, 300);
    const meta = {
      network: network.name,
      chainId: 31337,
      finishedAt: new Date().toISOString(),
      commit: "local",
      ttlC: 300,
    };
    writeResults(report, meta, path.join(process.cwd(), "results", "hardhat-spec"));
  });

  it("시나리오 구성: 정상 10 + 위반 40, 시나리오별 10건", function () {
    const by = (p: string) => defs.filter(d => d.scenario.startsWith(p)).length;
    expect([by("S1"), by("S2"), by("S3"), by("S4"), by("S5")]).to.deep.equal([10, 10, 10, 10, 10]);
  });

  it("S4 대조 결제는 만료 전에 성공한다", function () {
    expect(report.attempts.find(a => a.id === "S4-CTRL")!.verdict).to.equal("PASS");
  });

  for (const d of defs) {
    it(`${d.id} ${d.label} => ${d.expected}`, function () {
      const r = report.attempts.find(a => a.id === d.id)!;
      expect(r.reasons).to.deep.equal([]);
      expect(r.verdict).to.equal("PASS");
    });
  }

  it("컨트랙트 USDC 잔액과 토큰 value 합계가 일치한다", function () {
    expect(report.invariant.ok).to.equal(true);
  });

  it("대조군: 같은 요청을 일반 지갑으로 보내면 대부분 그대로 실행된다", function () {
    expect(report.control.length).to.equal(40);
    expect(report.control.filter(c => c.status === 1).length).to.be.greaterThan(30);
  });
});
