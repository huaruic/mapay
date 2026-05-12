// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @title Marketplace_ToolVersion — plan→execute drift protection via version anchor
contract Marketplace_ToolVersion is Base {
    function test_Pay_RevertsWhenVersionMismatch() public {
        uint128 price = 0.1 ether;
        uint256 toolId = _registerTool(alice, alicePayout, price);
        uint256 agentId = _createAgent(charlie, dave, price, 1 ether, 1 ether);
        bytes32 taskId = _startTask(dave, agentId, keccak256("p"), bytes32(uint256(1)));

        // Provider bumps version to 2 between plan and pay
        vm.prank(alice);
        marketplace.updateTool(toolId, price, true, keccak256("v2"));

        // Worker still tries to pay with stale version=1 → revert
        vm.prank(dave);
        vm.expectRevert(bytes("tool version mismatch"));
        marketplace.pay(taskId, toolId, 1, price, keccak256("a"));

        // Re-pay with correct version=2 succeeds
        vm.prank(dave);
        (bytes32 receiptId, ) = marketplace.pay(taskId, toolId, 2, price, keccak256("a"));
        Marketplace.Receipt memory r = marketplace.getReceipt(receiptId);
        assertEq(r.toolVersion, 2, "receipt anchors current version");

        agentId; // silence
    }

    function test_Pay_RevertsWhenToolDisabled() public {
        uint128 price = 0.1 ether;
        uint256 toolId = _registerTool(alice, alicePayout, price);
        uint256 agentId = _createAgent(charlie, dave, price, 1 ether, 1 ether);
        bytes32 taskId = _startTask(dave, agentId, keccak256("p"), bytes32(uint256(1)));

        // Disable (this bumps version too, by spec)
        vm.prank(alice);
        marketplace.updateTool(toolId, price, false, keccak256("v1"));

        vm.prank(dave);
        // Disabled check happens after version check? Actually pay checks: enabled first,
        // then version. We try with version=2 to bypass the version check and isolate
        // the "tool disabled" path.
        vm.expectRevert(bytes("tool disabled"));
        marketplace.pay(taskId, toolId, 2, price, keccak256("a"));

        agentId;
    }

    function test_PaySuccess_IncrementsStepIdx_AndDeductsBalance() public {
        uint128 price = 0.1 ether;
        uint256 toolId = _registerTool(alice, alicePayout, price);
        uint256 agentId = _createAgent(charlie, dave, price, 1 ether, 1 ether);
        bytes32 taskId = _startTask(dave, agentId, keccak256("p"), bytes32(uint256(1)));

        vm.prank(dave);
        (, uint32 stepIdx1) = marketplace.pay(taskId, toolId, 1, price, keccak256("a"));
        vm.prank(dave);
        (, uint32 stepIdx2) = marketplace.pay(taskId, toolId, 1, price, keccak256("b"));

        assertEq(uint256(stepIdx1), 1, "step 1");
        assertEq(uint256(stepIdx2), 2, "step 2");

        Marketplace.Agent memory a = marketplace.getAgent(agentId);
        assertEq(uint256(a.balance), uint256(1 ether) - uint256(2 * price), "balance debited");
        assertEq(uint256(a.totalSpent), uint256(2 * price), "totalSpent");

        Marketplace.Task memory t = marketplace.getTask(taskId);
        assertEq(uint256(t.stepCount), 2, "task stepCount");
    }
}
