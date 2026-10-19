import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("MockUSDC", function () {
  const INITIAL_SUPPLY = ethers.utils.parseUnits("1000000", 6);
  const MINT_AMOUNT    = ethers.utils.parseUnits("10000", 6);

  async function deployFixture() {
    const [owner, advertiser, stranger] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy(INITIAL_SUPPLY);
    await usdc.deployed();

    return { usdc, owner, advertiser, stranger };
  }

  describe("배포", function () {
    it("초기 공급량이 owner에게 발행되어야 한다", async function () {
      const { usdc, owner } = await loadFixture(deployFixture);
      expect(await usdc.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
    });

    it("decimals가 6이어야 한다", async function () {
      const { usdc } = await loadFixture(deployFixture);
      expect(await usdc.decimals()).to.equal(6);
    });

    it("토큰명과 심볼이 올바르게 설정되어야 한다", async function () {
      const { usdc } = await loadFixture(deployFixture);
      expect(await usdc.name()).to.equal("USD Coin");
      expect(await usdc.symbol()).to.equal("USDC");
    });
  });

  describe("mint()", function () {
    it("owner가 mint 시 잔액이 증가해야 한다", async function () {
      const { usdc, advertiser } = await loadFixture(deployFixture);

      await usdc.mint(advertiser.address, MINT_AMOUNT);

      expect(await usdc.balanceOf(advertiser.address)).to.equal(MINT_AMOUNT);
    });

    it("owner가 아닌 계정이 mint 시 revert되어야 한다", async function () {
      const { usdc, stranger, advertiser } = await loadFixture(deployFixture);

      await expect(
        usdc.connect(stranger).mint(advertiser.address, MINT_AMOUNT)
      ).to.be.revertedWith("Not owner");
    });
  });

  describe("approve() / allowance()", function () {
    it("approve 후 allowance가 올바르게 설정되어야 한다", async function () {
      const { usdc, owner, advertiser } = await loadFixture(deployFixture);

      await usdc.approve(advertiser.address, MINT_AMOUNT);

      expect(await usdc.allowance(owner.address, advertiser.address)).to.equal(MINT_AMOUNT);
    });
  });

  describe("balanceOf()", function () {
    it("mint 후 잔액이 정확히 조회되어야 한다", async function () {
      const { usdc, advertiser } = await loadFixture(deployFixture);

      await usdc.mint(advertiser.address, MINT_AMOUNT);

      expect(await usdc.balanceOf(advertiser.address)).to.equal(MINT_AMOUNT);
    });

    it("미발행 계정 잔액은 0이어야 한다", async function () {
      const { usdc, stranger } = await loadFixture(deployFixture);

      expect(await usdc.balanceOf(stranger.address)).to.equal(0);
    });
  });
});
