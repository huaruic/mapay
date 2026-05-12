// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @title Marketplace_AccessControl — task state machine + role checks +
///        rateTask invariants. Covers spec Requirement edge cases that don't
///        fit cleanly in the other files.
contract Marketplace_AccessControl is Base {
    event TaskRated(bytes32 indexed taskId, uint8 stars, uint16 newReputation);

    function _completeTask(uint128 price)
        internal
        returns (uint256 agentId, bytes32 taskId)
    {
        uint256 toolId = _registerTool(alice, alicePayout, price);
        agentId = _createAgent(charlie, dave, price, 1 ether, 1 ether);
        taskId = _startTask(dave, agentId, keccak256("p"), bytes32(uint256(1)));
        vm.prank(dave);
        marketplace.pay(taskId, toolId, 1, price, keccak256("body"));
        vm.prank(dave);
        marketplace.completeTask(taskId, keccak256("result"));
    }

    function test_StartTask_OnlyOperator() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        vm.prank(eve);
        vm.expectRevert(bytes("not operator"));
        marketplace.startTask(agentId, keccak256("p"), bytes32(uint256(1)));
    }

    function test_StartTask_RevertsOnDuplicateTaskId() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        vm.prank(dave);
        marketplace.startTask(agentId, keccak256("p"), bytes32(uint256(1)));
        vm.prank(dave);
        vm.expectRevert(bytes("task exists"));
        marketplace.startTask(agentId, keccak256("p"), bytes32(uint256(1)));
    }

    function test_CompleteTask_OnlyOperator_AndStatusTransition() public {
        uint128 price = 0.1 ether;
        uint256 toolId = _registerTool(alice, alicePayout, price);
        uint256 agentId = _createAgent(charlie, dave, price, 1 ether, 1 ether);
        bytes32 taskId = _startTask(dave, agentId, keccak256("p"), bytes32(uint256(1)));

        // Outsider can't complete
        vm.prank(eve);
        vm.expectRevert(bytes("not operator"));
        marketplace.completeTask(taskId, keccak256("r"));

        vm.prank(dave);
        marketplace.completeTask(taskId, keccak256("r"));

        // Can't complete twice
        vm.prank(dave);
        vm.expectRevert(bytes("task not open"));
        marketplace.completeTask(taskId, keccak256("r2"));

        // Can't pay after completion
        vm.prank(dave);
        vm.expectRevert(bytes("task not open"));
        marketplace.pay(taskId, toolId, 1, price, keccak256("late"));

        agentId;
    }

    function test_CancelTask_ByOwner_OrByOperator() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        // Cancel by owner
        bytes32 t1 = _startTask(dave, agentId, keccak256("a"), bytes32(uint256(1)));
        vm.prank(charlie);
        marketplace.cancelTask(t1);

        // Cancel by operator
        bytes32 t2 = _startTask(dave, agentId, keccak256("b"), bytes32(uint256(2)));
        vm.prank(dave);
        marketplace.cancelTask(t2);

        // Stranger can't cancel
        bytes32 t3 = _startTask(dave, agentId, keccak256("c"), bytes32(uint256(3)));
        vm.prank(eve);
        vm.expectRevert(bytes("not authorised"));
        marketplace.cancelTask(t3);
    }

    function test_FundAgent_OnlyOwner_AndIncreasesBalance() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);

        vm.deal(eve, 1 ether);
        vm.prank(eve);
        vm.expectRevert(bytes("not owner"));
        marketplace.fundAgent{value: 0.5 ether}(agentId);

        vm.prank(charlie);
        marketplace.fundAgent{value: 0.5 ether}(agentId);
        Marketplace.Agent memory a = marketplace.getAgent(agentId);
        assertEq(uint256(a.balance), 1.5 ether, "balance increased");
        assertEq(uint256(a.totalBudget), 1.5 ether, "totalBudget increased");
    }

    function test_WithdrawAgentBalance_OnlyOwner_CEI() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);

        vm.prank(eve);
        vm.expectRevert(bytes("not owner"));
        marketplace.withdrawAgentBalance(agentId, 0.1 ether);

        uint256 before = charlie.balance;
        vm.prank(charlie);
        marketplace.withdrawAgentBalance(agentId, 0.3 ether);
        Marketplace.Agent memory a = marketplace.getAgent(agentId);
        assertEq(uint256(a.balance), 0.7 ether, "balance decreased");
        assertEq(charlie.balance, before + 0.3 ether, "charlie received");
    }

    function test_SetOperator_OnlyOwner_AndAppliesImmediately() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        address newOp = makeAddr("new-op");

        vm.prank(eve);
        vm.expectRevert(bytes("not owner"));
        marketplace.setAgentOperator(agentId, newOp);

        vm.prank(charlie);
        marketplace.setAgentOperator(agentId, newOp);
        Marketplace.Agent memory a = marketplace.getAgent(agentId);
        assertEq(a.operator, newOp, "operator rotated");

        // Old operator can no longer start tasks
        vm.prank(dave);
        vm.expectRevert(bytes("not operator"));
        marketplace.startTask(agentId, keccak256("p"), bytes32(uint256(1)));
    }

    function test_SetDailyCap_RejectsCapBelowMaxPerCall() public {
        uint256 agentId = _createAgent(charlie, dave, 0.5 ether, 1 ether, 1 ether);
        vm.prank(charlie);
        vm.expectRevert(bytes("cap < maxPerCall"));
        marketplace.setAgentDailySpendCap(agentId, 0.4 ether);
    }

    function test_CreateAgent_RejectsCapBelowMaxPerCall() public {
        vm.prank(charlie);
        vm.expectRevert(bytes("maxPerCall > dailyCap"));
        marketplace.createAndFundAgent{value: 1 ether}(0.5 ether, 0.4 ether, dave, "x", "y");
    }

    function test_CreateAgent_RejectsCapAboveDeposit() public {
        vm.prank(charlie);
        vm.expectRevert(bytes("dailyCap > deposit"));
        marketplace.createAndFundAgent{value: 0.5 ether}(0.5 ether, 0.6 ether, dave, "x", "y");
    }

    function test_RateTask_OnlyOwner_OnlyCompleted_OnlyOnce_StarsRange() public {
        uint128 price = 0.1 ether;
        (uint256 agentId, bytes32 taskId) = _completeTask(price);

        // Non-owner can't rate
        vm.prank(eve);
        vm.expectRevert(bytes("not owner"));
        marketplace.rateTask(taskId, 5);

        // 0 stars rejected
        vm.prank(charlie);
        vm.expectRevert(bytes("stars out of range"));
        marketplace.rateTask(taskId, 0);

        // 6 stars rejected
        vm.prank(charlie);
        vm.expectRevert(bytes("stars out of range"));
        marketplace.rateTask(taskId, 6);

        // Rate 5
        vm.expectEmit(true, false, false, true);
        emit TaskRated(taskId, 5, 1000);
        vm.prank(charlie);
        marketplace.rateTask(taskId, 5);

        // Can't rate twice
        vm.prank(charlie);
        vm.expectRevert(bytes("already rated"));
        marketplace.rateTask(taskId, 5);

        Marketplace.Agent memory a = marketplace.getAgent(agentId);
        assertEq(uint256(a.reputation), 1000, "reputation = 1000 after a 5-star");
        // Passport mirror
        uint256 tokenId = passport.tokenIdOf(agentId);
        assertEq(uint256(passport.reputation(tokenId)), 1000, "passport reputation mirrored");
    }

    function test_RateTask_OnOpenTaskReverts() public {
        uint256 agentId = _createAgent(charlie, dave, 0.1 ether, 1 ether, 1 ether);
        bytes32 taskId = _startTask(dave, agentId, keccak256("p"), bytes32(uint256(1)));
        vm.prank(charlie);
        vm.expectRevert(bytes("task not completed"));
        marketplace.rateTask(taskId, 5);
    }

    function test_RateMultipleTasks_AveragesReputation() public {
        uint128 price = 0.1 ether;
        // Reuse one agent across multiple tasks.
        uint256 toolId = _registerTool(alice, alicePayout, price);
        uint256 agentId = _createAgent(charlie, dave, price, 1 ether, 1 ether);

        // task 1 rated 5 → rep = 1000
        bytes32 t1 = _startTask(dave, agentId, keccak256("a"), bytes32(uint256(1)));
        vm.prank(dave);
        marketplace.pay(t1, toolId, 1, price, keccak256("b1"));
        vm.prank(dave);
        marketplace.completeTask(t1, keccak256("r1"));
        vm.prank(charlie);
        marketplace.rateTask(t1, 5);

        // task 2 rated 3 → avg (5+3)/2 = 4 stars → 800
        bytes32 t2 = _startTask(dave, agentId, keccak256("b"), bytes32(uint256(2)));
        vm.prank(dave);
        marketplace.pay(t2, toolId, 1, price, keccak256("b2"));
        vm.prank(dave);
        marketplace.completeTask(t2, keccak256("r2"));
        vm.prank(charlie);
        marketplace.rateTask(t2, 3);

        Marketplace.Agent memory a = marketplace.getAgent(agentId);
        assertEq(uint256(a.reputation), 800, "avg 4 stars => 800/1000");
    }
}
