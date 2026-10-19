import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("PBMVault", function () {
  const INITIAL_SUPPLY = ethers.utils.parseUnits("1000000", 6);
  const DEPOSIT_AMOUNT = ethers.utils.parseUnits("1000", 6);
  const LOCK_PERIOD    = 60 * 60 * 24; // 1일 (초 단위)
  const TOKEN_ID       = 1;

  async function deployFixture() {
    const [owner, mockPBM, payer, payee, stranger] = await ethers.getSigners();

    // MockUSDC 배포
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy(INITIAL_SUPPLY);
    await usdc.deployed();

    // PBMVault 배포
    const PBMVault = await ethers.getContractFactory("contracts/PBMVault.sol:PBMVault");
    const vault = await PBMVault.deploy(usdc.address);
    await vault.deployed();

    // mockPBM을 PBM으로 등록
    await vault.setPBM(mockPBM.address);

    // mockPBM에 USDC 지급 및 vault 승인
    await usdc.mint(mockPBM.address, DEPOSIT_AMOUNT);
    await usdc.connect(mockPBM).approve(vault.address, DEPOSIT_AMOUNT);

    return { usdc, vault, owner, mockPBM, payer, payee, stranger };
  }

  describe("deposit()", function () {
    it("USDC가 vault에 잠금 보관되어야 한다", async function () {
      const { usdc, vault, mockPBM, payer, payee } = await loadFixture(deployFixture);

      await vault.connect(mockPBM).deposit(payer.address, payee.address, TOKEN_ID, DEPOSIT_AMOUNT, LOCK_PERIOD);

      expect(await usdc.balanceOf(vault.address)).to.equal(DEPOSIT_AMOUNT);
    });

    it("deposit 후 getDeposit으로 tokenId 정보가 조회되어야 한다", async function () {
      const { vault, mockPBM, payer, payee } = await loadFixture(deployFixture);

      await vault.connect(mockPBM).deposit(payer.address, payee.address, TOKEN_ID, DEPOSIT_AMOUNT, LOCK_PERIOD);

      const depositInfo = await vault.getDeposit(TOKEN_ID);
      expect(depositInfo.tokenId).to.equal(TOKEN_ID);
      expect(depositInfo.payer).to.equal(payer.address);
      expect(depositInfo.payee).to.equal(payee.address);
      expect(depositInfo.amount).to.equal(DEPOSIT_AMOUNT);
      expect(depositInfo.active).to.be.true;
    });

    it("Deposited 이벤트가 emit되어야 한다", async function () {
      const { vault, mockPBM, payer, payee } = await loadFixture(deployFixture);

      await expect(
        vault.connect(mockPBM).deposit(payer.address, payee.address, TOKEN_ID, DEPOSIT_AMOUNT, LOCK_PERIOD)
      ).to.emit(vault, "Deposited")
        .withArgs(TOKEN_ID, payer.address, payee.address, DEPOSIT_AMOUNT, anyValue);
    });

    it("PBM이 아닌 계정이 deposit 시 revert되어야 한다", async function () {
      const { vault, stranger, payer, payee } = await loadFixture(deployFixture);

      await expect(
        vault.connect(stranger).deposit(payer.address, payee.address, TOKEN_ID, DEPOSIT_AMOUNT, LOCK_PERIOD)
      ).to.be.revertedWithCustomError(vault, "CallerNotPBM");
    });
  });

  describe("withdraw()", function () {
    async function depositedFixture() {
      const base = await deployFixture();
      await base.vault.connect(base.mockPBM).deposit(
        base.payer.address, base.payee.address, TOKEN_ID, DEPOSIT_AMOUNT, LOCK_PERIOD
      );
      return base;
    }

    it("lockPeriod 만료 후 payee에게 USDC가 출금되어야 한다", async function () {
      const { usdc, vault, mockPBM, payee } = await loadFixture(depositedFixture);

      await time.increase(LOCK_PERIOD + 1);

      const before = await usdc.balanceOf(payee.address);
      await vault.connect(mockPBM).withdraw(payee.address, [TOKEN_ID]);
      const after = await usdc.balanceOf(payee.address);

      expect(after.sub(before)).to.equal(DEPOSIT_AMOUNT);
    });

    it("Withdrawn 이벤트가 emit되어야 한다", async function () {
      const { vault, mockPBM, payee } = await loadFixture(depositedFixture);

      await time.increase(LOCK_PERIOD + 1);

      await expect(
        vault.connect(mockPBM).withdraw(payee.address, [TOKEN_ID])
      ).to.emit(vault, "Withdrawn")
        .withArgs(TOKEN_ID, payee.address, DEPOSIT_AMOUNT);
    });

    it("lockPeriod 만료 전 withdraw 시 revert되어야 한다", async function () {
      const { vault, mockPBM, payee } = await loadFixture(depositedFixture);

      await expect(
        vault.connect(mockPBM).withdraw(payee.address, [TOKEN_ID])
      ).to.be.revertedWithCustomError(vault, "DepositNotMatured");
    });

    it("이미 출금된 deposit을 다시 출금 시 revert되어야 한다", async function () {
      const { vault, mockPBM, payee } = await loadFixture(depositedFixture);

      await time.increase(LOCK_PERIOD + 1);
      await vault.connect(mockPBM).withdraw(payee.address, [TOKEN_ID]);

      await expect(
        vault.connect(mockPBM).withdraw(payee.address, [TOKEN_ID])
      ).to.be.revertedWithCustomError(vault, "DepositNotActive");
    });
  });

  describe("refund()", function () {
    async function depositedFixture() {
      const base = await deployFixture();
      await base.vault.connect(base.mockPBM).deposit(
        base.payer.address, base.payee.address, TOKEN_ID, DEPOSIT_AMOUNT, LOCK_PERIOD
      );
      return base;
    }

    it("에스크로 기간 중 payer에게 USDC가 반환되어야 한다", async function () {
      const { usdc, vault, mockPBM, payer, payee } = await loadFixture(depositedFixture);

      const before = await usdc.balanceOf(payer.address);
      await vault.connect(mockPBM).refund(payee.address, TOKEN_ID);
      const after = await usdc.balanceOf(payer.address);

      expect(after.sub(before)).to.equal(DEPOSIT_AMOUNT);
    });

    it("Refunded 이벤트가 emit되어야 한다", async function () {
      const { vault, mockPBM, payer, payee } = await loadFixture(depositedFixture);

      await expect(
        vault.connect(mockPBM).refund(payee.address, TOKEN_ID)
      ).to.emit(vault, "Refunded")
        .withArgs(TOKEN_ID, payer.address, DEPOSIT_AMOUNT);
    });

    it("lockPeriod 만료 후 refund 시 revert되어야 한다", async function () {
      const { vault, mockPBM, payee } = await loadFixture(depositedFixture);

      await time.increase(LOCK_PERIOD + 1);

      await expect(
        vault.connect(mockPBM).refund(payee.address, TOKEN_ID)
      ).to.be.revertedWithCustomError(vault, "DepositAlreadyMatured");
    });
  });
});
