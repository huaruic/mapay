// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title Passport — Soulbound ERC-721 reputation NFT (ERC-8004 compatible).
/// @notice One Passport per Buyer Agent. Reputation and task history are written
///         only by the Marketplace contract. Transfers are disabled (soulbound).
///
/// ERC-8004 (Trustless Agents) compatibility surface:
///  - `agentScore(tokenId)`     — reputation read
///  - `agentMetadata(tokenId)`  — opaque metadata blob (here: ABI-encoded name + agentId)
///  - `supportsInterface`        — advertises an ERC-8004 interfaceId so other
///    marketplaces can discover this contract is ERC-8004 compatible.
///
/// NOTE on ERC-8004 interfaceId: the ERC-8004 EIP draft does not (yet) publish an
/// official interfaceId. We compute it locally from the three method selectors
/// (`agentScore`, `agentMetadata`, `tokenIdOf`). If the EIP later standardises a
/// canonical id, override `supportsInterface` to also advertise that.
contract Passport is ERC721 {
    using Strings for uint256;
    using Strings for uint16;

    // ── Storage ────────────────────────────────────────────────────────────

    address public marketplace;

    uint256 private _nextTokenId = 1;

    mapping(uint256 tokenId => uint16) public reputation;
    mapping(uint256 tokenId => bytes32[]) private _taskHistory;
    mapping(uint256 agentId => uint256 tokenId) public tokenIdOf;
    mapping(uint256 tokenId => uint256 agentId) public agentIdOf;
    mapping(uint256 tokenId => string) public agentName;

    // ── Events ─────────────────────────────────────────────────────────────

    event MarketplaceSet(address indexed marketplace);
    event PassportMinted(uint256 indexed tokenId, uint256 indexed agentId, address indexed to);
    event TaskAppended(uint256 indexed tokenId, bytes32 indexed taskId);
    event ReputationUpdated(uint256 indexed tokenId, uint16 newReputation);

    // ── Constructor ────────────────────────────────────────────────────────

    constructor() ERC721("AgentPay Passport", "AGENTPP") {}

    // ── Modifiers ──────────────────────────────────────────────────────────

    modifier onlyMarketplace() {
        require(msg.sender == marketplace, "only marketplace");
        _;
    }

    // ── Wiring ─────────────────────────────────────────────────────────────

    /// @notice One-shot wiring. Called once after Marketplace is deployed.
    function setMarketplace(address marketplaceAddr) external {
        require(marketplace == address(0), "already set");
        require(marketplaceAddr != address(0), "zero address");
        marketplace = marketplaceAddr;
        emit MarketplaceSet(marketplaceAddr);
    }

    // ── Soulbound: block transfers ─────────────────────────────────────────

    /// @dev Overriding `_update` lets mint/burn through (from==0 / to==0) but
    ///      reverts any owner-to-owner transfer.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert("soulbound");
        }
        return super._update(to, tokenId, auth);
    }

    // ── Marketplace-only writes ────────────────────────────────────────────

    function mint(address to, uint256 agentId) external onlyMarketplace returns (uint256 tokenId) {
        require(tokenIdOf[agentId] == 0, "already minted");
        tokenId = _nextTokenId++;
        _mint(to, tokenId);
        tokenIdOf[agentId] = tokenId;
        agentIdOf[tokenId] = agentId;
        emit PassportMinted(tokenId, agentId, to);
    }

    function setAgentName(uint256 tokenId, string calldata name) external onlyMarketplace {
        require(_ownerOf(tokenId) != address(0), "no token");
        agentName[tokenId] = name;
    }

    function appendTask(uint256 tokenId, bytes32 taskId) external onlyMarketplace {
        require(_ownerOf(tokenId) != address(0), "no token");
        _taskHistory[tokenId].push(taskId);
        emit TaskAppended(tokenId, taskId);
    }

    function updateReputation(uint256 tokenId, uint16 newReputation) external onlyMarketplace {
        require(_ownerOf(tokenId) != address(0), "no token");
        require(newReputation <= 1000, "reputation > 1000");
        reputation[tokenId] = newReputation;
        emit ReputationUpdated(tokenId, newReputation);
    }

    // ── Views ──────────────────────────────────────────────────────────────

    function taskHistory(uint256 tokenId) external view returns (bytes32[] memory) {
        return _taskHistory[tokenId];
    }

    function taskHistoryLength(uint256 tokenId) external view returns (uint256) {
        return _taskHistory[tokenId].length;
    }

    // ── ERC-8004 (Trustless Agents) compat surface ─────────────────────────

    function agentScore(uint256 tokenId) external view returns (uint256) {
        return reputation[tokenId];
    }

    function agentMetadata(uint256 tokenId) external view returns (bytes memory) {
        return abi.encode(agentIdOf[tokenId], agentName[tokenId]);
    }

    /// @dev Locally-computed ERC-8004 selector bundle. See contract NatSpec for
    ///      why this is not the canonical EIP id (EIP draft has not published one).
    function erc8004InterfaceId() public pure returns (bytes4) {
        return
            this.agentScore.selector ^
            this.agentMetadata.selector ^
            this.tokenIdOf.selector;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override
        returns (bool)
    {
        return interfaceId == erc8004InterfaceId() || super.supportsInterface(interfaceId);
    }

    // ── On-chain SVG tokenURI ──────────────────────────────────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory name = agentName[tokenId];
        uint16 rep = reputation[tokenId];
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 350">',
            '<rect width="350" height="350" fill="#0a0a0a"/>',
            '<text x="20" y="40" fill="#fff" font-family="monospace" font-size="14">AgentPay Passport</text>',
            '<text x="20" y="180" fill="#7df9ff" font-family="monospace" font-size="22">',
            bytes(name).length == 0 ? "(unnamed)" : name,
            "</text>",
            '<text x="20" y="220" fill="#fff" font-family="monospace" font-size="14">reputation</text>',
            '<text x="20" y="260" fill="#7df9ff" font-family="monospace" font-size="36">',
            uint256(rep).toString(),
            " / 1000</text>",
            '<text x="20" y="320" fill="#888" font-family="monospace" font-size="10">soulbound \xc2\xb7 ERC-8004</text>',
            "</svg>"
        );
        string memory json = Base64.encode(
            bytes(
                string.concat(
                    '{"name":"AgentPay Passport #',
                    tokenId.toString(),
                    '","description":"Soulbound reputation NFT for AgentPay buyer agent.",',
                    '"attributes":[{"trait_type":"reputation","value":',
                    uint256(rep).toString(),
                    "}],",
                    '"image":"data:image/svg+xml;base64,',
                    Base64.encode(bytes(svg)),
                    '"}'
                )
            )
        );
        return string.concat("data:application/json;base64,", json);
    }
}
