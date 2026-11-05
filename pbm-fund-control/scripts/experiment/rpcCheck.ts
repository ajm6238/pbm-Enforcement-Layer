/**
 * 실제 RPC의 오류 형식을 키 없이 확인한다. eth_call만 사용하며 트랜잭션을 보내지 않는다.
 * 기존 배포본을 대상으로 위반 요청을 시뮬레이션해 errorDecoder가 사유를 해석하는지 본다.
 */
import { ethers } from "hardhat";

import { errorDecoder, usd } from "../../experiment/core";

const WRAPPER = "0x2B313076BB5E0CcA650E387442ac024b17d30927";
const LOGIC = "0xc2758aF169520424a282B1cf821251EBAAd627DE";
const AGENT = "0xdFeaaC981817AF5F527728d2F66E55ba8bDc3708";
const CLOUDFLARE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const KT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

async function main() {
  const p: any = ethers.provider;
  const wrapper = (await ethers.getContractAt("PBMWrapper", WRAPPER)).connect(new ethers.VoidSigner(AGENT, p));
  const logic = await ethers.getContractAt("PBMLogic", LOGIC);
  const decode = errorDecoder({ wrapper, logic } as any);

  const cases: [string, any[], string][] = [
    ["한도 초과", [2, CLOUDFLARE, usd("40000")], "AutoLimitExceededError"],
    ["벤더 위반", [2, KT, usd("1000")], "VendorNotAllowedByMandate"],
  ];
  for (const [name, a, want] of cases) {
    try {
      await wrapper.callStatic.pay(a[0], a[1], a[2], "rpc_check", { gasLimit: 300_000 });
      console.log(`${name}: 시뮬레이션 성공(차단 안 됨), 기대 ${want}`);
    } catch (e: any) {
      const got = decode(e);
      console.log(`${name}: ${got} ${got === want ? "OK" : `(기대 ${want})`}`);
    }
  }
  const block = await p.getBlockNumber();
  const old = await (wrapper as any)["valueOf(uint256)"](2, { blockTag: block - 5 });
  console.log(`과거 블록 지정 조회: OK (block ${block - 5}, value ${old})`);
  const gp = await p.getGasPrice();
  console.log(`gasPrice: ${ethers.utils.formatUnits(gp, "gwei")} gwei`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
