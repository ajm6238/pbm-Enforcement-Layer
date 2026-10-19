// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";

contract PBMLogic is Ownable {
    struct SlotPolicy {
        address[] whitelist;
        uint256 budgetLimit;
        uint256 budgetUsed;
    }

    address public wrapper;

    mapping(uint256 => SlotPolicy) private _slots;
    mapping(uint256 => mapping(address => bool)) private _whitelistIndex;

    event SlotCreated(uint256 indexed slotId, uint256 budgetLimit);
    event WhitelistAdded(uint256 indexed slotId, address indexed merchant);
    event WhitelistRemoved(uint256 indexed slotId, address indexed merchant);
    event BudgetUsedUpdated(uint256 indexed slotId, uint256 amount, uint256 totalUsed);

    error SlotAlreadyExists(uint256 slotId);
    error SlotNotFound(uint256 slotId);
    error MerchantNotWhitelisted(uint256 slotId, address merchant);
    error BudgetExceeded(uint256 slotId, uint256 requested, uint256 remaining);
    error CallerNotWrapper();

    modifier onlyWrapper() {
        if (msg.sender != wrapper) revert CallerNotWrapper();
        _;
    }

    function setWrapper(address wrapper_) external onlyOwner {
        wrapper = wrapper_;
    }

    function createSlot(
        uint256 slotId,
        address[] calldata whitelist,
        uint256 budgetLimit
    ) external onlyOwner {
        if (_slots[slotId].budgetLimit != 0) revert SlotAlreadyExists(slotId);

        _slots[slotId].budgetLimit = budgetLimit;

        for (uint256 i = 0; i < whitelist.length; i++) {
            _slots[slotId].whitelist.push(whitelist[i]);
            _whitelistIndex[slotId][whitelist[i]] = true;
        }

        emit SlotCreated(slotId, budgetLimit);
    }

    function addToWhitelist(uint256 slotId, address merchant) external onlyOwner {
        if (_slots[slotId].budgetLimit == 0) revert SlotNotFound(slotId);
        if (_whitelistIndex[slotId][merchant]) return;

        _slots[slotId].whitelist.push(merchant);
        _whitelistIndex[slotId][merchant] = true;

        emit WhitelistAdded(slotId, merchant);
    }

    function removeFromWhitelist(uint256 slotId, address merchant) external onlyOwner {
        if (_slots[slotId].budgetLimit == 0) revert SlotNotFound(slotId);
        if (!_whitelistIndex[slotId][merchant]) return;

        _whitelistIndex[slotId][merchant] = false;

        address[] storage list = _slots[slotId].whitelist;
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == merchant) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }

        emit WhitelistRemoved(slotId, merchant);
    }

    function canTransfer(uint256 slotId, address to, uint256 amount) external view returns (bool) {
        SlotPolicy storage policy = _slots[slotId];

        if (!_whitelistIndex[slotId][to]) {
            revert MerchantNotWhitelisted(slotId, to);
        }

        uint256 remaining = policy.budgetLimit - policy.budgetUsed;
        if (amount > remaining) {
            revert BudgetExceeded(slotId, amount, remaining);
        }

        return true;
    }

    function updateBudgetUsed(uint256 slotId, uint256 amount) external onlyWrapper {
        if (_slots[slotId].budgetLimit == 0) revert SlotNotFound(slotId);

        _slots[slotId].budgetUsed += amount;

        emit BudgetUsedUpdated(slotId, amount, _slots[slotId].budgetUsed);
    }

    function getSlotPolicy(uint256 slotId) external view returns (SlotPolicy memory) {
        return _slots[slotId];
    }
}
