import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("PBMLogic", function () {
  const SLOT_ID      = 1;
  const BUDGET_LIMIT = ethers.utils.parseUnits("10000", 6); // 10,000 USDC
  const PAY_AMOUNT   = ethers.utils.parseUnits("1000", 6);  // 1,000 USDC
  const OVER_AMOUNT  = ethers.utils.parseUnits("99999", 6); // 초과 금액

  async function deployFixture() {
    const [owner, wrapper, merchant, stranger] = await ethers.getSigners();

    const PBMLogic = await ethers.getContractFactory("PBMLogic");
    const logic = await PBMLogic.deploy();
    await logic.deployed();

    await logic.setWrapper(wrapper.address);

    return { logic, owner, wrapper, merchant, stranger };
  }

  async function slotCreatedFixture() {
    const base = await deployFixture();
    await base.logic.createSlot(SLOT_ID, [base.merchant.address], BUDGET_LIMIT);
    return base;
  }

  describe("createSlot()", function () {
    it("slotId가 올바르게 생성되어야 한다", async function () {
      const { logic, merchant } = await loadFixture(deployFixture);

      await logic.createSlot(SLOT_ID, [merchant.address], BUDGET_LIMIT);

      const policy = await logic.getSlotPolicy(SLOT_ID);
      expect(policy.budgetLimit).to.equal(BUDGET_LIMIT);
      expect(policy.budgetUsed).to.equal(0);
    });

    it("화이트리스트 주소가 등록되어야 한다", async function () {
      const { logic, merchant } = await loadFixture(deployFixture);

      await logic.createSlot(SLOT_ID, [merchant.address], BUDGET_LIMIT);

      const policy = await logic.getSlotPolicy(SLOT_ID);
      expect(policy.whitelist).to.include(merchant.address);
    });

    it("SlotCreated 이벤트가 emit되어야 한다", async function () {
      const { logic, merchant } = await loadFixture(deployFixture);

      await expect(logic.createSlot(SLOT_ID, [merchant.address], BUDGET_LIMIT))
        .to.emit(logic, "SlotCreated")
        .withArgs(SLOT_ID, BUDGET_LIMIT);
    });

    it("동일한 slotId 재생성 시 revert되어야 한다", async function () {
      const { logic, merchant } = await loadFixture(deployFixture);

      await logic.createSlot(SLOT_ID, [merchant.address], BUDGET_LIMIT);

      await expect(
        logic.createSlot(SLOT_ID, [merchant.address], BUDGET_LIMIT)
      ).to.be.revertedWithCustomError(logic, "SlotAlreadyExists");
    });

    it("owner가 아닌 계정이 createSlot 시 revert되어야 한다", async function () {
      const { logic, merchant, stranger } = await loadFixture(deployFixture);

      await expect(
        logic.connect(stranger).createSlot(SLOT_ID, [merchant.address], BUDGET_LIMIT)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("canTransfer()", function () {
    it("화이트리스트에 등록된 주소 + 예산 한도 이내 → true 반환", async function () {
      const { logic, merchant } = await loadFixture(slotCreatedFixture);

      expect(await logic.canTransfer(SLOT_ID, merchant.address, PAY_AMOUNT)).to.be.true;
    });

    it("화이트리스트 미등록 주소 → MerchantNotWhitelisted revert", async function () {
      const { logic, stranger } = await loadFixture(slotCreatedFixture);

      await expect(
        logic.canTransfer(SLOT_ID, stranger.address, PAY_AMOUNT)
      ).to.be.revertedWithCustomError(logic, "MerchantNotWhitelisted");
    });

    it("예산 한도 초과 금액 → BudgetExceeded revert", async function () {
      const { logic, merchant } = await loadFixture(slotCreatedFixture);

      await expect(
        logic.canTransfer(SLOT_ID, merchant.address, OVER_AMOUNT)
      ).to.be.revertedWithCustomError(logic, "BudgetExceeded");
    });
  });

  describe("addToWhitelist() / removeFromWhitelist()", function () {
    it("가맹점 추가 후 canTransfer가 통과해야 한다", async function () {
      const { logic, stranger } = await loadFixture(slotCreatedFixture);

      await logic.addToWhitelist(SLOT_ID, stranger.address);

      expect(await logic.canTransfer(SLOT_ID, stranger.address, PAY_AMOUNT)).to.be.true;
    });

    it("가맹점 제거 후 canTransfer가 revert되어야 한다", async function () {
      const { logic, merchant } = await loadFixture(slotCreatedFixture);

      await logic.removeFromWhitelist(SLOT_ID, merchant.address);

      await expect(
        logic.canTransfer(SLOT_ID, merchant.address, PAY_AMOUNT)
      ).to.be.revertedWithCustomError(logic, "MerchantNotWhitelisted");
    });
  });

  describe("updateBudgetUsed()", function () {
    it("wrapper가 updateBudgetUsed 호출 시 budgetUsed가 업데이트되어야 한다", async function () {
      const { logic, wrapper } = await loadFixture(slotCreatedFixture);

      await logic.connect(wrapper).updateBudgetUsed(SLOT_ID, PAY_AMOUNT);

      const policy = await logic.getSlotPolicy(SLOT_ID);
      expect(policy.budgetUsed).to.equal(PAY_AMOUNT);
    });

    it("BudgetUsedUpdated 이벤트가 emit되어야 한다", async function () {
      const { logic, wrapper } = await loadFixture(slotCreatedFixture);

      await expect(logic.connect(wrapper).updateBudgetUsed(SLOT_ID, PAY_AMOUNT))
        .to.emit(logic, "BudgetUsedUpdated")
        .withArgs(SLOT_ID, PAY_AMOUNT, PAY_AMOUNT);
    });

    it("wrapper가 아닌 계정이 호출 시 revert되어야 한다", async function () {
      const { logic, stranger } = await loadFixture(slotCreatedFixture);

      await expect(
        logic.connect(stranger).updateBudgetUsed(SLOT_ID, PAY_AMOUNT)
      ).to.be.revertedWithCustomError(logic, "CallerNotWrapper");
    });

    it("예산 누적 후 초과 금액 canTransfer → revert", async function () {
      const { logic, wrapper, merchant } = await loadFixture(slotCreatedFixture);

      // 9,500 USDC 사용
      await logic.connect(wrapper).updateBudgetUsed(SLOT_ID, ethers.utils.parseUnits("9500", 6));

      // 남은 예산 500인데 1,000 요청 → 초과
      await expect(
        logic.canTransfer(SLOT_ID, merchant.address, PAY_AMOUNT)
      ).to.be.revertedWithCustomError(logic, "BudgetExceeded");
    });
  });
});
