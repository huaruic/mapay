// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @title Marketplace_RegisterTool — Spec Requirement: "Provider 注册 Tool 到链上 Marketplace"
contract Marketplace_RegisterTool is Base {
    event ToolRegistered(uint256 indexed toolId, address indexed provider, uint128 price, uint64 version);
    event ToolUpdated(uint256 indexed toolId, uint128 newPrice, uint64 newVersion, bool enabled, bytes32 schemaHash);

    function test_RegisterTool_SetsAllFields_AndEmitsEvent_AndIncrementsId() public {
        // expect event with version=1
        vm.expectEmit(true, true, false, true);
        emit ToolRegistered(1, alice, 0.01 ether, 1);

        vm.prank(alice);
        uint256 toolId = marketplace.registerTool(
            "https://copywriter.example/v1",
            keccak256("schema-copywriter-v1"),
            0.01 ether,
            "copywriter-pro",
            "Marketing copy in <140 chars.",
            alicePayout
        );

        assertEq(toolId, 1, "first toolId");
        assertEq(marketplace.nextToolId(), 2, "nextToolId advanced");

        Marketplace.Tool memory t = marketplace.getTool(toolId);
        assertEq(t.provider, alice, "provider stored");
        assertEq(t.payout, alicePayout, "payout stored");
        assertEq(t.pricePerCall, 0.01 ether, "price stored");
        assertEq(t.version, 1, "initial version 1");
        assertTrue(t.enabled, "enabled by default");
        assertEq(t.schemaHash, keccak256("schema-copywriter-v1"), "schemaHash stored");
        assertEq(t.endpoint, "https://copywriter.example/v1", "endpoint stored");
        assertEq(t.name, "copywriter-pro", "name stored");
    }

    function test_RegisterTool_RevertsOnZeroPayout() public {
        vm.prank(alice);
        vm.expectRevert(bytes("zero payout"));
        marketplace.registerTool(
            "https://x.example",
            keccak256("s"),
            1,
            "n",
            "d",
            address(0)
        );
    }

    function test_RegisterTool_RevertsOnEmptyEndpoint() public {
        vm.prank(alice);
        vm.expectRevert(bytes("empty endpoint"));
        marketplace.registerTool("", keccak256("s"), 1, "n", "d", alicePayout);
    }

    function test_UpdateTool_BumpsVersion_ChangesFields_EmitsEvent() public {
        uint256 toolId = _registerTool(alice, alicePayout, 0.01 ether);
        bytes32 newSchema = keccak256("schema-v2");

        vm.expectEmit(true, false, false, true);
        emit ToolUpdated(toolId, 0.02 ether, 2, true, newSchema);

        vm.prank(alice);
        marketplace.updateTool(toolId, 0.02 ether, true, newSchema);

        Marketplace.Tool memory t = marketplace.getTool(toolId);
        assertEq(t.pricePerCall, 0.02 ether, "price updated");
        assertEq(t.version, 2, "version bumped");
        assertEq(t.schemaHash, newSchema, "schema updated");
        assertTrue(t.enabled, "enabled");
    }

    function test_UpdateTool_RevertsForNonProvider() public {
        uint256 toolId = _registerTool(alice, alicePayout, 0.01 ether);
        vm.prank(eve);
        vm.expectRevert(bytes("not provider"));
        marketplace.updateTool(toolId, 0.02 ether, true, keccak256("x"));
    }

    function test_UpdateTool_CanDisable() public {
        uint256 toolId = _registerTool(alice, alicePayout, 0.01 ether);
        vm.prank(alice);
        marketplace.updateTool(toolId, 0.01 ether, false, keccak256("schema-v1"));
        Marketplace.Tool memory t = marketplace.getTool(toolId);
        assertFalse(t.enabled, "tool disabled");
        assertEq(t.version, 2, "version still bumps on disable");
    }
}
