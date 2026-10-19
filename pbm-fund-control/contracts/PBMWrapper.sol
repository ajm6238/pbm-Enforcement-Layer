// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./lib/ERC3525/ERC3525.sol";

interface IPBMLogic {
    function canTransfer(uint256 slotId, address to, uint256 amount) external view returns (bool);
    function updateBudgetUsed(uint256 slotId, uint256 amount) external;
}

/**
 * @title PBMWrapper
 * @dev ERC-3525 기반 Purpose Bound Money
 *      SLOT  = 정책 단위 (PBMLogic의 slotId와 1:1 매핑, 계층 구조 가능: 정부 SLOT → 사용자 SLOT)
 *      TOKEN = 바우처. mint 시 실제 USDC를 컨트랙트에 예치하고, value만큼 사용 가능한 잔액을 표시
 *      VALUE = 남은 사용 가능 USDC 금액 (decimals 6)
 *
 *      정부가 발행한 바우처(tokenId=1, slot=1)에서 사용자가 자신의 하위 SLOT으로 만든
 *      바우처(tokenId=2, slot=2)로 value를 옮기는 계층형 구조를 지원하기 위해
 *      transferValue()는 서로 다른 SLOT 간 이동을 허용한다 (표준 transferFrom은 그대로 둠).
 */
contract PBMWrapper is ERC3525, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct MandateCondition {
        address agentAddress; // 위임된 Agent 주소
        uint256 autoLimit; // 자율 결제 한도
        uint256 expiresAt; // 위임 만료 시각 (unix timestamp)
        address[] allowedVendors; // 비어있으면 제한 없음. 비어있지 않으면 이 목록의 payee만 허용
    }

    IERC20 public usdc;
    IPBMLogic public logic;
    address public vault;

    mapping(uint256 => MandateCondition) private _mandates;
    mapping(uint256 => address) private _tokenAgent;

    event Payment(uint256 indexed tokenId, address indexed payee, uint256 amount, string purpose);
    event ValueTransferred(uint256 indexed fromTokenId, uint256 indexed toTokenId, uint256 amount);
    event ApprovalForToken(uint256 indexed tokenId, address indexed agentAddress);

    error ZeroAddress();
    error NotTokenOwner(uint256 tokenId, address caller);
    error NotApprovedAgent(uint256 tokenId, address caller);
    error MandateExpired(uint256 tokenId, uint256 expiresAt);
    error AutoLimitExceededError(uint256 tokenId, uint256 amount, uint256 autoLimit);
    error VendorNotAllowedByMandate();

    constructor() ERC3525("Purpose Bound Money", "PBM", 6) {}

    function initialize(address usdc_, address logic_, address vault_) external onlyOwner {
        if (usdc_ == address(0) || logic_ == address(0) || vault_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        logic = IPBMLogic(logic_);
        vault = vault_;
    }

    /**
     * @notice PBM 바우처 발행. value만큼 USDC를 발행자(msg.sender)로부터 예치받아 컨트랙트가
     *         보관하고, 그 금액을 대표하는 ERC-3525 토큰을 to에게 mint한다.
     *         value=0으로 호출하면 아직 잔액이 없는 빈 바우처(SLOT 전용 컨테이너)를 만들 수 있다.
     */
    function mint(address to, uint256 slotId, uint256 value) external onlyOwner returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (value > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), value);
        }
        tokenId = _mint(to, slotId, value);
    }

    /**
     * @notice tokenId 소유자가 Agent 자율 결제 조건(Mandate)을 등록한다.
     */
    function setMandateCondition(uint256 tokenId, MandateCondition calldata condition) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
        if (condition.agentAddress == address(0)) revert ZeroAddress();
        _mandates[tokenId] = condition;
    }

    /**
     * @notice tokenId를 Agent에게 위임하여, 해당 Agent가 pay()를 대신 호출할 수 있게 한다.
     * @dev ERC-3525의 value 단위 approve(uint256,address,uint256)와는 별개의, tokenId 전체를
     *      결제 대리인에게 위임하는 PBM 전용 오버로드다.
     */
    function approve(uint256 tokenId, address agentAddress) public {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
        if (agentAddress == address(0)) revert ZeroAddress();
        _tokenAgent[tokenId] = agentAddress;
        emit ApprovalForToken(tokenId, agentAddress);
    }

    /**
     * @notice fromTokenId에서 toTokenId로 value를 이동한다 (정부 SLOT → 사용자 SLOT처럼
     *         서로 다른 SLOT 간 이동을 허용하는 PBM 전용 기능).
     */
    function transferValue(uint256 fromTokenId, uint256 toTokenId, uint256 amount) external {
        if (ownerOf(fromTokenId) != msg.sender) revert NotTokenOwner(fromTokenId, msg.sender);
        _transferValueAcrossSlots(fromTokenId, toTokenId, amount);
        emit ValueTransferred(fromTokenId, toTokenId, amount);
    }

    /**
     * @notice 결제 실행. tokenId 소유자 본인 또는 위임된 Agent가 호출할 수 있다.
     *
     * 검증 순서:
     * ① 소유자가 아닌 호출자는 approve된 Agent인지 확인
     * ② Mandate 만료 여부 확인
     * ③ amount가 autoLimit을 초과하면 즉시 revert하여 결제를 하드 차단한다 (클라우드 과금 방지가
     *    목적이므로 초과분은 어떤 경우에도 실행되어서는 안 된다).
     * ④ allowedVendors가 비어있지 않으면 payee가 그 목록에 있는지 확인 (Mandate 단위 벤더 제한)
     * ⑤ PBMLogic.canTransfer() — 화이트리스트 + 예산 한도 검증 (실패 시 revert)
     * ⑥ tokenId value 차감
     * ⑦ USDC → payee 이전
     * ⑧ PBMLogic.updateBudgetUsed() 호출
     * ⑨ Payment 이벤트 emit
     */
    function pay(
        uint256 tokenId,
        address payee,
        uint256 amount,
        string calldata purpose
    ) external nonReentrant {
        address owner = ownerOf(tokenId);

        if (msg.sender != owner) {
            if (msg.sender != _tokenAgent[tokenId]) revert NotApprovedAgent(tokenId, msg.sender);

            MandateCondition memory mandate = _mandates[tokenId];
            if (block.timestamp >= mandate.expiresAt) revert MandateExpired(tokenId, mandate.expiresAt);
            if (amount > mandate.autoLimit) revert AutoLimitExceededError(tokenId, amount, mandate.autoLimit);

            if (mandate.allowedVendors.length > 0) {
                bool vendorAllowed = false;
                for (uint256 i = 0; i < mandate.allowedVendors.length; i++) {
                    if (mandate.allowedVendors[i] == payee) {
                        vendorAllowed = true;
                        break;
                    }
                }
                if (!vendorAllowed) revert VendorNotAllowedByMandate();
            }
        }

        uint256 slotId = slotOf(tokenId);
        logic.canTransfer(slotId, payee, amount);

        _decreaseValue(tokenId, amount);
        usdc.safeTransfer(payee, amount);
        logic.updateBudgetUsed(slotId, amount);

        emit Payment(tokenId, payee, amount, purpose);
    }

    function setLogic(address logic_) external onlyOwner {
        if (logic_ == address(0)) revert ZeroAddress();
        logic = IPBMLogic(logic_);
    }

    function setVault(address vault_) external onlyOwner {
        if (vault_ == address(0)) revert ZeroAddress();
        vault = vault_;
    }

    function getMandateCondition(uint256 tokenId) external view returns (MandateCondition memory) {
        return _mandates[tokenId];
    }

    function agentOf(uint256 tokenId) external view returns (address) {
        return _tokenAgent[tokenId];
    }

    // ERC3525 _mint는 ERC721의 _safeMint를 내부에서 호출하므로, 수신자가 컨트랙트일 때를
    // 대비해 onERC721Received 콜백을 처리한다.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC3525) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
