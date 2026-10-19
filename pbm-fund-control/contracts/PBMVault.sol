// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PBMVault is Ownable {
    using SafeERC20 for IERC20;

    struct DepositInfo {
        uint256 tokenId;
        address payer;
        address payee;
        uint256 amount;
        uint64 maturityTimestamp;
        bool active;
    }

    IERC20 public asset;
    address public pbm;

    mapping(uint256 => DepositInfo) private _deposits;

    event Deposited(
        uint256 indexed tokenId,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        uint64 maturityTimestamp
    );
    event Withdrawn(uint256 indexed tokenId, address indexed payee, uint256 amount);
    event Refunded(uint256 indexed tokenId, address indexed payer, uint256 amount);

    error CallerNotPBM();
    error DepositNotActive(uint256 tokenId);
    error DepositNotFound(uint256 tokenId);
    error DepositNotMatured(uint256 tokenId);
    error DepositAlreadyMatured(uint256 tokenId);

    modifier onlyPBM() {
        if (msg.sender != pbm) revert CallerNotPBM();
        _;
    }

    constructor(address asset_) {
        asset = IERC20(asset_);
    }

    function setPBM(address pbm_) external onlyOwner {
        pbm = pbm_;
    }

    function deposit(
        address payer,
        address payee,
        uint256 tokenId,
        uint256 amount,
        uint64 lockPeriod
    ) external onlyPBM {
        uint64 maturityTimestamp = uint64(block.timestamp) + lockPeriod;
        _deposits[tokenId] = DepositInfo({
            tokenId: tokenId,
            payer: payer,
            payee: payee,
            amount: amount,
            maturityTimestamp: maturityTimestamp,
            active: true
        });
        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(tokenId, payer, payee, amount, maturityTimestamp);
    }

    function withdraw(
        address payee,
        uint256[] calldata tokenIds
    ) external onlyPBM returns (uint256 totalAmount) {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            DepositInfo storage d = _deposits[tokenId];
            if (!d.active) revert DepositNotActive(tokenId);
            if (d.payee != payee) revert DepositNotFound(tokenId);
            if (block.timestamp < d.maturityTimestamp) revert DepositNotMatured(tokenId);

            d.active = false;
            totalAmount += d.amount;
            emit Withdrawn(tokenId, payee, d.amount);
        }
        if (totalAmount > 0) {
            asset.safeTransfer(payee, totalAmount);
        }
    }

    function refund(address payee, uint256 tokenId) external onlyPBM {
        DepositInfo storage d = _deposits[tokenId];
        if (!d.active) revert DepositNotActive(tokenId);
        if (d.payee != payee) revert DepositNotFound(tokenId);
        if (block.timestamp >= d.maturityTimestamp) revert DepositAlreadyMatured(tokenId);

        address payer = d.payer;
        uint256 amount = d.amount;
        d.active = false;

        asset.safeTransfer(payer, amount);
        emit Refunded(tokenId, payer, amount);
    }

    function getDeposit(uint256 tokenId) external view returns (DepositInfo memory) {
        return _deposits[tokenId];
    }
}
