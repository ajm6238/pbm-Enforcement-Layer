// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "./IERC3525.sol";

/**
 * @title ERC3525 Semi-Fungible Token
 * @dev Minimal implementation based on https://github.com/solv-finance/erc-3525
 *      Each token has: ID (unique, ERC-721), SLOT (category), VALUE (amount)
 */
abstract contract ERC3525 is ERC721, IERC3525 {
    using Counters for Counters.Counter;

    struct TokenData {
        uint256 slot;
        uint256 value;
    }

    Counters.Counter private _tokenIdCounter;

    mapping(uint256 => TokenData) private _tokenData;
    mapping(uint256 => mapping(address => uint256)) private _valueAllowances;

    uint8 private immutable _decimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 valueDecimals_
    ) ERC721(name_, symbol_) {
        _decimals = valueDecimals_;
    }

    // ── IERC3525 views ────────────────────────────────────────────────

    function valueDecimals() public view override returns (uint8) {
        return _decimals;
    }

    function valueOf(uint256 tokenId) public view override returns (uint256) {
        require(_exists(tokenId), "ERC3525: nonexistent token");
        return _tokenData[tokenId].value;
    }

    function slotOf(uint256 tokenId) public view override returns (uint256) {
        require(_exists(tokenId), "ERC3525: nonexistent token");
        return _tokenData[tokenId].slot;
    }

    function allowance(uint256 tokenId, address operator) public view override returns (uint256) {
        return _valueAllowances[tokenId][operator];
    }

    // ── IERC3525 value approval ───────────────────────────────────────

    function approve(uint256 tokenId, address to, uint256 value) public override {
        address owner = ownerOf(tokenId);
        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender),
            "ERC3525: not authorized"
        );
        _valueAllowances[tokenId][to] = value;
        emit ApprovalValue(tokenId, to, value);
    }

    // ── IERC3525 value transfers ──────────────────────────────────────

    /// @notice Transfer value from a token → new token owned by `to`
    function transferFrom(
        uint256 fromTokenId,
        address to,
        uint256 value
    ) public override returns (uint256 newTokenId) {
        _spendValueAllowance(fromTokenId, msg.sender, value);
        require(_tokenData[fromTokenId].value >= value, "ERC3525: insufficient value");
        _tokenData[fromTokenId].value -= value;
        newTokenId = _mintToken(to, _tokenData[fromTokenId].slot, value);
        emit TransferValue(fromTokenId, newTokenId, value);
    }

    /// @notice Transfer value between two tokens in the same slot
    function transferFrom(
        uint256 fromTokenId,
        uint256 toTokenId,
        uint256 value
    ) public override {
        require(
            _tokenData[fromTokenId].slot == _tokenData[toTokenId].slot,
            "ERC3525: slot mismatch"
        );
        _spendValueAllowance(fromTokenId, msg.sender, value);
        require(_tokenData[fromTokenId].value >= value, "ERC3525: insufficient value");
        _tokenData[fromTokenId].value -= value;
        _tokenData[toTokenId].value += value;
        emit TransferValue(fromTokenId, toTokenId, value);
    }

    // ── ERC165 ────────────────────────────────────────────────────────

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC721, IERC165) returns (bool) {
        return
            interfaceId == type(IERC3525).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // ── Internal mint / burn ──────────────────────────────────────────

    /**
     * @dev Mint a new ERC-3525 token.
     * @param to    Recipient address
     * @param slot  Slot (policy ID)
     * @param value Token value (USDC amount)
     * @return tokenId The newly minted token ID
     */
    function _mint(
        address to,
        uint256 slot,
        uint256 value
    ) internal virtual returns (uint256 tokenId) {
        tokenId = _mintToken(to, slot, value);
    }

    /**
     * @dev Burn an ERC-3525 token and clear its data.
     */
    function _burn(uint256 tokenId) internal virtual override {
        uint256 value = _tokenData[tokenId].value;
        uint256 slot  = _tokenData[tokenId].slot;

        emit TransferValue(tokenId, 0, value);
        emit SlotChanged(tokenId, slot, 0);

        delete _tokenData[tokenId];
        super._burn(tokenId);
    }

    function currentTokenId() public view returns (uint256) {
        return _tokenIdCounter.current();
    }

    /**
     * @dev Reduce a token's value without moving it to another token (e.g. spent on a payment).
     *      Mirrors the burn event shape (toTokenId = 0) without deleting the token itself.
     */
    function _decreaseValue(uint256 tokenId, uint256 value) internal virtual {
        require(_exists(tokenId), "ERC3525: nonexistent token");
        require(_tokenData[tokenId].value >= value, "ERC3525: insufficient value");
        _tokenData[tokenId].value -= value;
        emit TransferValue(tokenId, 0, value);
    }

    /**
     * @dev Move value between two tokens regardless of slot. The standard
     *      {transferFrom(uint256,uint256,uint256)} enforces same-slot transfers because slots
     *      normally denote fungibility classes; PBM slots are hierarchical policy scopes
     *      (parent budget -> child budget), so this PBM-specific helper deliberately skips
     *      that check. Standard transferFrom is left untouched for spec compliance.
     */
    function _transferValueAcrossSlots(uint256 fromTokenId, uint256 toTokenId, uint256 value) internal virtual {
        require(_exists(fromTokenId) && _exists(toTokenId), "ERC3525: nonexistent token");
        require(_tokenData[fromTokenId].value >= value, "ERC3525: insufficient value");
        _tokenData[fromTokenId].value -= value;
        _tokenData[toTokenId].value += value;
        emit TransferValue(fromTokenId, toTokenId, value);
    }

    // ── Private helpers ───────────────────────────────────────────────

    function _mintToken(
        address to,
        uint256 slot,
        uint256 value
    ) private returns (uint256 tokenId) {
        _tokenIdCounter.increment();
        tokenId = _tokenIdCounter.current();

        _safeMint(to, tokenId);
        _tokenData[tokenId] = TokenData({ slot: slot, value: value });

        emit SlotChanged(tokenId, 0, slot);
        emit TransferValue(0, tokenId, value);
    }

    function _spendValueAllowance(
        uint256 tokenId,
        address operator,
        uint256 value
    ) private {
        address owner = ownerOf(tokenId);
        if (operator != owner && !isApprovedForAll(owner, operator)) {
            uint256 current = _valueAllowances[tokenId][operator];
            require(current >= value, "ERC3525: insufficient value allowance");
            _valueAllowances[tokenId][operator] = current - value;
        }
    }
}
