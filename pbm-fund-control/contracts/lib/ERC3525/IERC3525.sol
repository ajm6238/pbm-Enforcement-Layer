// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title ERC-3525 Semi-Fungible Token Standard
 * @dev Based on https://github.com/solv-finance/erc-3525
 */
interface IERC3525 is IERC721 {
    /// @dev Emitted when value is transferred between tokens in the same slot
    event TransferValue(uint256 indexed fromTokenId, uint256 indexed toTokenId, uint256 value);

    /// @dev Emitted when value allowance is approved
    event ApprovalValue(uint256 indexed tokenId, address indexed operator, uint256 value);

    /// @dev Emitted when a token's slot changes
    event SlotChanged(uint256 indexed tokenId, uint256 indexed oldSlot, uint256 indexed newSlot);

    /// @notice Returns the number of decimals for value
    function valueDecimals() external view returns (uint8);

    /// @notice Returns the value (balance) of a token
    function valueOf(uint256 tokenId) external view returns (uint256);

    /// @notice Returns the slot of a token
    function slotOf(uint256 tokenId) external view returns (uint256);

    /// @notice Approve an operator to transfer value from a token
    function approve(uint256 tokenId, address to, uint256 value) external;

    /// @notice Returns how much value an operator is allowed to transfer from a token
    function allowance(uint256 tokenId, address operator) external view returns (uint256);

    /// @notice Transfer value from a token to a new token owned by `to`
    function transferFrom(uint256 fromTokenId, address to, uint256 value) external returns (uint256 newTokenId);

    /// @notice Transfer value between two tokens in the same slot
    function transferFrom(uint256 fromTokenId, uint256 toTokenId, uint256 value) external;
}
