// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";
import {Passport} from "../src/Passport.sol";

/// @title Passport_Soulbound — Spec Requirement: "Passport NFT 为 Soulbound 且仅 Marketplace 可写"
contract Passport_Soulbound is Base {
    function test_MintByMarketplace_OnAgentCreate() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        uint256 tokenId = passport.tokenIdOf(agentId);
        assertEq(tokenId, 1, "first passport tokenId");
        assertEq(passport.ownerOf(tokenId), charlie, "owned by agent owner");
    }

    function test_TransferFrom_Reverts_Soulbound() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        uint256 tokenId = passport.tokenIdOf(agentId);

        vm.prank(charlie);
        vm.expectRevert(bytes("soulbound"));
        passport.transferFrom(charlie, eve, tokenId);
    }

    function test_SafeTransferFrom_Reverts_Soulbound() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        uint256 tokenId = passport.tokenIdOf(agentId);

        vm.prank(charlie);
        vm.expectRevert(bytes("soulbound"));
        passport.safeTransferFrom(charlie, eve, tokenId);
    }

    function test_SafeTransferFrom_WithData_Reverts_Soulbound() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        uint256 tokenId = passport.tokenIdOf(agentId);

        vm.prank(charlie);
        vm.expectRevert(bytes("soulbound"));
        passport.safeTransferFrom(charlie, eve, tokenId, "");
    }

    function test_NonMarketplaceCannotMint() public {
        vm.prank(eve);
        vm.expectRevert(bytes("only marketplace"));
        passport.mint(eve, 42);
    }

    function test_NonMarketplaceCannotUpdateReputation() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        uint256 tokenId = passport.tokenIdOf(agentId);

        vm.prank(eve);
        vm.expectRevert(bytes("only marketplace"));
        passport.updateReputation(tokenId, 999);
    }

    function test_NonMarketplaceCannotAppendTask() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        uint256 tokenId = passport.tokenIdOf(agentId);

        vm.prank(eve);
        vm.expectRevert(bytes("only marketplace"));
        passport.appendTask(tokenId, keccak256("t"));
    }

    function test_SetMarketplace_OnlyOnce() public {
        // setMarketplace was already called in Base.setUp(), so any further call must revert.
        vm.prank(deployer);
        vm.expectRevert(bytes("already set"));
        passport.setMarketplace(address(0xdead));

        // Even with a fresh contract, a second set fails.
        Passport p2 = new Passport();
        p2.setMarketplace(address(this));
        vm.expectRevert(bytes("already set"));
        p2.setMarketplace(address(0xdead));
    }

    function test_SetMarketplace_RejectsZeroAddress() public {
        Passport p2 = new Passport();
        vm.expectRevert(bytes("zero address"));
        p2.setMarketplace(address(0));
    }

    function test_ERC8004_SupportsInterface_AdvertisesId() public view {
        bytes4 id = passport.erc8004InterfaceId();
        assertTrue(passport.supportsInterface(id), "advertises ERC-8004 id");
        // ERC-165 (0x01ffc9a7) must still be supported (standard ERC721)
        assertTrue(passport.supportsInterface(0x01ffc9a7), "ERC-165");
        // ERC721 (0x80ac58cd)
        assertTrue(passport.supportsInterface(0x80ac58cd), "ERC-721");
    }

    function test_AgentScore_MirrorsReputation() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        uint256 tokenId = passport.tokenIdOf(agentId);
        assertEq(passport.agentScore(tokenId), 0, "initial 0");
        // After Marketplace rates a task, agentScore should mirror.
        // We do this through normal marketplace flow elsewhere; here we just check
        // the read-through works at zero.
    }

    function test_TokenURI_RendersOnChainSVG() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        uint256 tokenId = passport.tokenIdOf(agentId);
        string memory uri = passport.tokenURI(tokenId);
        // Just sanity: must start with the data: prefix and be non-trivial length.
        bytes memory b = bytes(uri);
        assertGt(b.length, 100, "non-trivial uri");
        // Compare prefix
        bytes memory prefix = bytes("data:application/json;base64,");
        for (uint256 i = 0; i < prefix.length; i++) {
            assertEq(b[i], prefix[i], "data uri prefix");
        }
    }
}
