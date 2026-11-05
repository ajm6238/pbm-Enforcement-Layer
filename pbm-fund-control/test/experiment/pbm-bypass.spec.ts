import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { AUTO_LIMIT, Chain, M1, PURPOSE, addr, deploySystem, usd } from "../../experiment/core";

const OTHER = addr("bypass/other");
const NOT_OWNER = "Ownable: caller is not the owner";

async function fixture() {
  const [issuer, holder, agent, stranger, newOwner] = await ethers.getSigners();
  const s = await deploySystem(new Chain(ethers.provider, true), { issuer, holder, agent }, { ttlC: 3600 });
  return { ...s, issuer, holder, agent, stranger, newOwner };
}

describe("우회 시도: Agent 키로는 정책을 벗어날 수 없어야 한다", function () {
  it("자신의 Mandate를 고칠 수 없다", async function () {
    const { wrapper, agent, tokens } = await loadFixture(fixture);
    const cond = { agentAddress: agent.address, autoLimit: usd("999999"), expiresAt: 4102444800, allowedVendors: [] };
    await expect(wrapper.connect(agent).setMandateCondition(tokens.A, cond)).to.be.revertedWithCustomError(
      wrapper,
      "NotTokenOwner",
    );
  });

  it("다른 주소에 위임할 수 없다", async function () {
    const { wrapper, agent, stranger, tokens } = await loadFixture(fixture);
    await expect(
      wrapper.connect(agent)["approve(uint256,address)"](tokens.A, stranger.address),
    ).to.be.revertedWithCustomError(wrapper, "NotTokenOwner");
  });

  it("transferValue로 value를 옮길 수 없다", async function () {
    const { wrapper, agent, tokens } = await loadFixture(fixture);
    await expect(wrapper.connect(agent).transferValue(tokens.A, tokens.B, 1)).to.be.revertedWithCustomError(
      wrapper,
      "NotTokenOwner",
    );
  });

  it("ERC-3525 transferFrom(token→address)로 value를 뺄 수 없다", async function () {
    const { wrapper, agent, tokens } = await loadFixture(fixture);
    await expect(
      wrapper.connect(agent)["transferFrom(uint256,address,uint256)"](tokens.A, agent.address, 1),
    ).to.be.revertedWith("ERC3525: insufficient value allowance");
  });

  it("ERC-3525 transferFrom(token→token)으로 value를 옮길 수 없다", async function () {
    const { wrapper, issuer, agent, tokens } = await loadFixture(fixture);
    await wrapper.connect(issuer).mint(agent.address, 1, 0);
    const own = await wrapper.currentTokenId();
    await expect(
      wrapper.connect(agent)["transferFrom(uint256,uint256,uint256)"](tokens.A, own, 1),
    ).to.be.revertedWith("ERC3525: insufficient value allowance");
  });

  it("ERC-3525 value approve를 자기에게 줄 수 없다", async function () {
    const { wrapper, agent, tokens } = await loadFixture(fixture);
    await expect(
      wrapper.connect(agent)["approve(uint256,address,uint256)"](tokens.A, agent.address, 1),
    ).to.be.revertedWith("ERC3525: not authorized");
  });

  it("ERC-721 transferFrom으로 토큰을 가져갈 수 없다", async function () {
    const { wrapper, agent, holder, tokens } = await loadFixture(fixture);
    await expect(
      wrapper.connect(agent)["transferFrom(address,address,uint256)"](holder.address, agent.address, tokens.A),
    ).to.be.reverted;
  });

  it("PBMLogic.updateBudgetUsed를 직접 호출할 수 없다", async function () {
    const { logic, agent } = await loadFixture(fixture);
    await expect(logic.connect(agent).updateBudgetUsed(1, 1)).to.be.revertedWithCustomError(logic, "CallerNotWrapper");
  });

  it("화이트리스트와 슬롯을 변경할 수 없다", async function () {
    const { logic, agent } = await loadFixture(fixture);
    const l = logic.connect(agent);
    await expect(l.addToWhitelist(1, OTHER)).to.be.revertedWith(NOT_OWNER);
    await expect(l.removeFromWhitelist(1, M1)).to.be.revertedWith(NOT_OWNER);
    await expect(l.createSlot(9, [OTHER], 1)).to.be.revertedWith(NOT_OWNER);
    await expect(l.setWrapper(agent.address)).to.be.revertedWith(NOT_OWNER);
  });

  it("Wrapper 관리 함수를 호출할 수 없다", async function () {
    const { wrapper, agent, usdc, logic } = await loadFixture(fixture);
    const w = wrapper.connect(agent);
    await expect(w.setLogic(agent.address)).to.be.revertedWith(NOT_OWNER);
    await expect(w.setVault(agent.address)).to.be.revertedWith(NOT_OWNER);
    await expect(w.initialize(usdc.address, logic.address, agent.address)).to.be.revertedWith(NOT_OWNER);
    await expect(w.mint(agent.address, 1, 0)).to.be.revertedWith(NOT_OWNER);
  });

  it("컨트랙트의 USDC를 직접 꺼낼 수 없다", async function () {
    const { usdc, wrapper, agent } = await loadFixture(fixture);
    await expect(usdc.connect(agent).transferFrom(wrapper.address, agent.address, 1)).to.be.reverted;
  });

  it("위임받지 않은 주소는 결제할 수 없다", async function () {
    const { wrapper, stranger, tokens } = await loadFixture(fixture);
    await expect(wrapper.connect(stranger).pay(tokens.A, M1, 1, PURPOSE)).to.be.revertedWithCustomError(
      wrapper,
      "NotApprovedAgent",
    );
  });
});

describe("경계값", function () {
  it("금액 = autoLimit은 성공, +1은 차단", async function () {
    const { wrapper, agent, tokens } = await loadFixture(fixture);
    await expect(wrapper.connect(agent).pay(tokens.A, M1, AUTO_LIMIT, PURPOSE)).to.emit(wrapper, "Payment");
    await expect(wrapper.connect(agent).pay(tokens.A, M1, AUTO_LIMIT.add(1), PURPOSE)).to.be.revertedWithCustomError(
      wrapper,
      "AutoLimitExceededError",
    );
  });

  it("금액 = 남은 예산은 성공, 이후 1단위도 차단", async function () {
    const { wrapper, logic, agent, tokens } = await loadFixture(fixture);
    await wrapper.connect(agent).pay(tokens.B, M1, usd("10000"), PURPOSE);
    await expect(wrapper.connect(agent).pay(tokens.B, M1, 1, PURPOSE)).to.be.revertedWithCustomError(
      logic,
      "BudgetExceeded",
    );
  });

  it("만료 1초 전은 성공, 만료 시각 정각은 차단", async function () {
    const { wrapper, agent, tokens, expiresAtC } = await loadFixture(fixture);
    await time.setNextBlockTimestamp(expiresAtC - 1);
    await expect(wrapper.connect(agent).pay(tokens.C, M1, 1, PURPOSE)).to.emit(wrapper, "Payment");
    await time.setNextBlockTimestamp(expiresAtC);
    await expect(wrapper.connect(agent).pay(tokens.C, M1, 1, PURPOSE)).to.be.revertedWithCustomError(
      wrapper,
      "MandateExpired",
    );
  });

  it("Mandate 없이 위임만 된 Agent는 결제할 수 없다", async function () {
    const { wrapper, issuer, holder, agent } = await loadFixture(fixture);
    await wrapper.connect(issuer).mint(holder.address, 1, 0);
    const id = await wrapper.currentTokenId();
    await wrapper.connect(holder)["approve(uint256,address)"](id, agent.address);
    await expect(wrapper.connect(agent).pay(id, M1, 1, PURPOSE)).to.be.revertedWithCustomError(
      wrapper,
      "MandateExpired",
    );
  });
});
