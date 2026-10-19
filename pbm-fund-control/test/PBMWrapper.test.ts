import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("PBMWrapper", function () {
  const INITIAL_SUPPLY = ethers.utils.parseUnits("1000000", 6);
  const PAYER_BALANCE  = ethers.utils.parseUnits("10000", 6);
  const BUDGET_LIMIT   = ethers.utils.parseUnits("5000", 6);
  const PAY_AMOUNT     = ethers.utils.parseUnits("1000", 6);
  const OVER_AMOUNT    = ethers.utils.parseUnits("9999", 6);
  const SLOT_ID        = 1;

  async function deployFixture() {
    const [owner, payer, merchant, stranger] = await ethers.getSigners();

    // MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy(INITIAL_SUPPLY);
    await usdc.deployed();

    // PBMVault
    const PBMVault = await ethers.getContractFactory("contracts/PBMVault.sol:PBMVault");
    const vault = await PBMVault.deploy(usdc.address);
    await vault.deployed();

    // PBMLogic
    const PBMLogic = await ethers.getContractFactory("PBMLogic");
    const logic = await PBMLogic.deploy();
    await logic.deployed();

    // PBMWrapper
    const PBMWrapper = await ethers.getContractFactory("PBMWrapper");
    const wrapper = await PBMWrapper.deploy();
    await wrapper.deployed();

    // 초기화
    await wrapper.initialize(usdc.address, logic.address, vault.address);
    await wrapper.addPayer(payer.address);
    await logic.setWrapper(wrapper.address);

    // 슬롯 생성 (merchant 화이트리스트 + 예산)
    await logic.createSlot(SLOT_ID, [merchant.address], BUDGET_LIMIT);

    // payer에게 USDC 지급 + wrapper approve
    await usdc.mint(payer.address, PAYER_BALANCE);
    await usdc.connect(payer).approve(wrapper.address, PAYER_BALANCE);

    return { usdc, vault, logic, wrapper, owner, payer, merchant, stranger };
  }

  describe("pay() - 정상 동작", function () {
    it("광고주(payer) USDC 잔액이 감소해야 한다", async function () {
      const { usdc, wrapper, payer, merchant } = await loadFixture(deployFixture);

      const before = await usdc.balanceOf(payer.address);
      await wrapper.connect(payer).pay(merchant.address, SLOT_ID, PAY_AMOUNT);
      const after = await usdc.balanceOf(payer.address);

      expect(before.sub(after)).to.equal(PAY_AMOUNT);
    });

    it("가맹점(merchant) USDC 잔액이 증가해야 한다", async function () {
      const { usdc, wrapper, payer, merchant } = await loadFixture(deployFixture);

      const before = await usdc.balanceOf(merchant.address);
      await wrapper.connect(payer).pay(merchant.address, SLOT_ID, PAY_AMOUNT);
      const after = await usdc.balanceOf(merchant.address);

      expect(after.sub(before)).to.equal(PAY_AMOUNT);
    });

    it("Payment 이벤트가 emit되어야 한다", async function () {
      const { wrapper, payer, merchant } = await loadFixture(deployFixture);

      const tx = await wrapper.connect(payer).pay(merchant.address, SLOT_ID, PAY_AMOUNT);
      const receipt = await tx.wait();

      const paymentEvent = receipt.events?.find((e: any) => e.event === "Payment");
      expect(paymentEvent).to.not.be.undefined;
      expect(paymentEvent?.args?.payer).to.equal(payer.address);
      expect(paymentEvent?.args?.payee).to.equal(merchant.address);
      expect(paymentEvent?.args?.slotId).to.equal(SLOT_ID);
      expect(paymentEvent?.args?.amount).to.equal(PAY_AMOUNT);
    });

    it("ERC-3525 mint 후 즉시 burn: TransferValue 이벤트 2회 emit되어야 한다", async function () {
      const { wrapper, payer, merchant } = await loadFixture(deployFixture);

      const tx = await wrapper.connect(payer).pay(merchant.address, SLOT_ID, PAY_AMOUNT);
      const receipt = await tx.wait();

      // TransferValue(0, tokenId, amount) - mint
      // TransferValue(tokenId, 0, amount) - burn
      const transferValueEvents = receipt.events?.filter((e: any) => e.event === "TransferValue");
      expect(transferValueEvents?.length).to.be.gte(2);

      const mintEvent = transferValueEvents?.find(
        (e: any) => e.args?.fromTokenId.eq(0) && e.args?.value.eq(PAY_AMOUNT)
      );
      expect(mintEvent).to.not.be.undefined;

      const burnEvent = transferValueEvents?.find(
        (e: any) => e.args?.toTokenId.eq(0) && e.args?.value.eq(PAY_AMOUNT)
      );
      expect(burnEvent).to.not.be.undefined;
    });

    it("ERC-3525 SlotChanged 이벤트 2회 emit (mint: 0→slot, burn: slot→0)", async function () {
      const { wrapper, payer, merchant } = await loadFixture(deployFixture);

      const tx = await wrapper.connect(payer).pay(merchant.address, SLOT_ID, PAY_AMOUNT);
      const receipt = await tx.wait();

      const slotEvents = receipt.events?.filter((e: any) => e.event === "SlotChanged");
      expect(slotEvents?.length).to.be.gte(2);

      // mint: SlotChanged(tokenId, 0, SLOT_ID)
      const mintSlot = slotEvents?.find(
        (e: any) => e.args?.oldSlot.eq(0) && e.args?.newSlot.eq(SLOT_ID)
      );
      expect(mintSlot).to.not.be.undefined;

      // burn: SlotChanged(tokenId, SLOT_ID, 0)
      const burnSlot = slotEvents?.find(
        (e: any) => e.args?.oldSlot.eq(SLOT_ID) && e.args?.newSlot.eq(0)
      );
      expect(burnSlot).to.not.be.undefined;
    });

    it("pay() 후 currentTokenId가 증가해야 한다", async function () {
      const { wrapper, payer, merchant } = await loadFixture(deployFixture);

      expect(await wrapper.currentTokenId()).to.equal(0);
      await wrapper.connect(payer).pay(merchant.address, SLOT_ID, PAY_AMOUNT);
      expect(await wrapper.currentTokenId()).to.equal(1);
    });

    it("pay() 후 PBMLogic의 budgetUsed가 업데이트되어야 한다", async function () {
      const { logic, wrapper, payer, merchant } = await loadFixture(deployFixture);

      await wrapper.connect(payer).pay(merchant.address, SLOT_ID, PAY_AMOUNT);

      const policy = await logic.getSlotPolicy(SLOT_ID);
      expect(policy.budgetUsed).to.equal(PAY_AMOUNT);
    });
  });

  describe("pay() - 차단 케이스", function () {
    it("payer 권한 없는 계정이 pay() 시 CallerNotPayer revert", async function () {
      const { wrapper, stranger, merchant } = await loadFixture(deployFixture);

      await expect(
        wrapper.connect(stranger).pay(merchant.address, SLOT_ID, PAY_AMOUNT)
      ).to.be.revertedWithCustomError(wrapper, "CallerNotPayer");
    });

    it("화이트리스트 미등록 payee → MerchantNotWhitelisted revert", async function () {
      const { wrapper, payer, stranger } = await loadFixture(deployFixture);

      await expect(
        wrapper.connect(payer).pay(stranger.address, SLOT_ID, PAY_AMOUNT)
      ).to.be.revertedWithCustomError(await ethers.getContractAt("PBMLogic", await wrapper.logic()), "MerchantNotWhitelisted");
    });

    it("예산 한도 초과 pay() → BudgetExceeded revert", async function () {
      const { usdc, wrapper, payer, merchant } = await loadFixture(deployFixture);

      // 추가 approve
      await usdc.mint(payer.address, OVER_AMOUNT);
      await usdc.connect(payer).approve(wrapper.address, OVER_AMOUNT);

      await expect(
        wrapper.connect(payer).pay(merchant.address, SLOT_ID, OVER_AMOUNT)
      ).to.be.revertedWithCustomError(await ethers.getContractAt("PBMLogic", await wrapper.logic()), "BudgetExceeded");
    });
  });

  describe("ERC-3525 표준 확인", function () {
    it("valueDecimals가 6이어야 한다 (USDC와 동일)", async function () {
      const { wrapper } = await loadFixture(deployFixture);
      expect(await wrapper.valueDecimals()).to.equal(6);
    });

    it("ERC-3525 인터페이스를 지원해야 한다", async function () {
      const { wrapper } = await loadFixture(deployFixture);
      // IERC3525 interfaceId
      const IERC3525_ID = "0x832d45c7";
      expect(await wrapper.supportsInterface(IERC3525_ID)).to.be.true;
    });

    it("ERC-721 인터페이스를 지원해야 한다", async function () {
      const { wrapper } = await loadFixture(deployFixture);
      const IERC721_ID = "0x80ac58cd";
      expect(await wrapper.supportsInterface(IERC721_ID)).to.be.true;
    });
  });
});
