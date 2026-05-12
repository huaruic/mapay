// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @title Marketplace_DailyCap — Spec Requirement: pay() enforces rolling 24h dailySpendCap
contract Marketplace_DailyCap is Base {
    function _setup(uint128 price, uint128 cap, uint256 fund)
        internal
        returns (uint256 toolId, uint256 agentId, bytes32 taskId)
    {
        toolId = _registerTool(alice, alicePayout, price);
        agentId = _createAgent(charlie, dave, price, cap, fund);
        taskId = _startTask(dave, agentId, keccak256("p"), bytes32(uint256(1)));
    }

    function test_DailyCap_BlocksThirdCallSameWindow() public {
        uint128 price = 0.1 ether;
        // dailyCap allows exactly two calls
        (uint256 toolId, , bytes32 taskId) = _setup(price, 0.2 ether, 1 ether);

        vm.prank(dave);
        marketplace.pay(taskId, toolId, 1, price, keccak256("a"));
        vm.prank(dave);
        marketplace.pay(taskId, toolId, 1, price, keccak256("b"));

        vm.prank(dave);
        vm.expectRevert(bytes("daily cap exceeded"));
        marketplace.pay(taskId, toolId, 1, price, keccak256("c"));
    }

    function test_DailyCap_ResetsAfter24h() public {
        uint128 price = 0.1 ether;
        (uint256 toolId, uint256 agentId, bytes32 taskId) = _setup(price, 0.2 ether, 1 ether);

        vm.prank(dave);
        marketplace.pay(taskId, toolId, 1, price, keccak256("a"));
        vm.prank(dave);
        marketplace.pay(taskId, toolId, 1, price, keccak256("b"));

        // Warp 1 day + 1s
        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(dave);
        marketplace.pay(taskId, toolId, 1, price, keccak256("c"));

        Marketplace.Agent memory a = marketplace.getAgent(agentId);
        assertEq(uint256(a.dailySpent), uint256(price), "dailySpent reset to one call");
    }

    function test_Pay_RevertsOnPriceMismatch() public {
        uint128 price = 0.1 ether;
        (uint256 toolId, , bytes32 taskId) = _setup(price, 1 ether, 1 ether);

        vm.prank(dave);
        vm.expectRevert(bytes("price mismatch"));
        marketplace.pay(taskId, toolId, 1, price + 1, keccak256("a"));
    }

    function test_Pay_RevertsWhenExceedsMaxPerCall() public {
        uint128 price = 0.5 ether;
        uint256 toolId = _registerTool(alice, alicePayout, price);
        // maxPerCall is *less* than price → should fail.
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        bytes32 taskId = _startTask(dave, agentId, keccak256("p"), bytes32(uint256(1)));

        vm.prank(dave);
        vm.expectRevert(bytes("exceeds max per call"));
        marketplace.pay(taskId, toolId, 1, price, keccak256("a"));
    }

    function test_Pay_RevertsOnInsufficientBalance() public {
        uint128 price = 0.5 ether;
        uint256 toolId = _registerTool(alice, alicePayout, price);
        // Create agent properly funded, then have owner withdraw balance below price
        // to isolate the "insufficient balance" require.
        uint256 agentId = _createAgent(charlie, dave, price, price, 0.5 ether);
        vm.prank(charlie);
        marketplace.withdrawAgentBalance(agentId, 0.4 ether); // balance now 0.1 ether < price

        bytes32 taskId = _startTask(dave, agentId, keccak256("p"), bytes32(uint256(1)));

        vm.prank(dave);
        vm.expectRevert(bytes("insufficient balance"));
        marketplace.pay(taskId, toolId, 1, price, keccak256("a"));
    }
}
