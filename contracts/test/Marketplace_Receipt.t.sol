// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @title Marketplace_Receipt — Spec Requirement: "链上 Receipt 设计防重放与跨合约重放"
contract Marketplace_Receipt is Base {
    event ReceiptConsumed(bytes32 indexed receiptId);

    function _setupReceipt(bytes32 inputHash)
        internal
        returns (uint256 toolId, bytes32 taskId, bytes32 receiptId, uint128 price)
    {
        price = 0.02 ether;
        toolId = _registerTool(alice, alicePayout, price);
        uint256 agentId = _createAgent(charlie, dave, price, price * 10, 1 ether);
        taskId = _startTask(dave, agentId, keccak256("p"), bytes32(uint256(1)));
        vm.prank(dave);
        (receiptId, ) = marketplace.pay(taskId, toolId, 1, price, inputHash);
    }

    function test_ReceiptId_IsBoundToAllNineFields() public {
        bytes32 inputHash = keccak256("body");
        (uint256 toolId, bytes32 taskId, bytes32 receiptId, uint128 price) = _setupReceipt(inputHash);

        Marketplace.Receipt memory r = marketplace.getReceipt(receiptId);
        assertEq(r.taskId, taskId, "taskId");
        assertEq(r.agentId, 1, "agentId");
        assertEq(r.toolId, toolId, "toolId");
        assertEq(r.toolVersion, 1, "toolVersion");
        assertEq(r.stepIdx, 1, "stepIdx");
        assertEq(uint256(r.amount), uint256(price), "amount");
        assertEq(r.inputHash, inputHash, "inputHash");
        assertFalse(r.consumed, "fresh receipt");

        // The receiptId must equal keccak256 of the full nine-field tuple.
        bytes32 expected = keccak256(
            abi.encode(
                taskId,
                uint256(1),
                toolId,
                uint64(1),
                uint32(1),
                price,
                inputHash,
                block.chainid,
                address(marketplace)
            )
        );
        assertEq(receiptId, expected, "receiptId binds nine fields");
    }

    function test_VerifyAndConsume_HappyPath_OnlyProvider_AtomicSetsConsumed() public {
        bytes32 inputHash = keccak256("body");
        (, , bytes32 receiptId, ) = _setupReceipt(inputHash);

        vm.expectEmit(true, false, false, false);
        emit ReceiptConsumed(receiptId);

        vm.prank(alice);
        bool ok = marketplace.verifyAndConsumeReceipt(receiptId, inputHash);
        assertTrue(ok, "returns ok");

        Marketplace.Receipt memory r = marketplace.getReceipt(receiptId);
        assertTrue(r.consumed, "consumed flag set in same tx");
    }

    function test_VerifyAndConsume_RevertsOnReplay() public {
        bytes32 inputHash = keccak256("body");
        (, , bytes32 receiptId, ) = _setupReceipt(inputHash);

        vm.prank(alice);
        marketplace.verifyAndConsumeReceipt(receiptId, inputHash);

        vm.prank(alice);
        vm.expectRevert(bytes("receipt already consumed"));
        marketplace.verifyAndConsumeReceipt(receiptId, inputHash);
    }

    function test_VerifyAndConsume_RevertsForNonProvider() public {
        bytes32 inputHash = keccak256("body");
        (, , bytes32 receiptId, ) = _setupReceipt(inputHash);

        vm.prank(eve);
        vm.expectRevert(bytes("not provider"));
        marketplace.verifyAndConsumeReceipt(receiptId, inputHash);
    }

    function test_VerifyAndConsume_RevertsOnInputHashMismatch() public {
        bytes32 inputHash = keccak256("body");
        (, , bytes32 receiptId, ) = _setupReceipt(inputHash);

        vm.prank(alice);
        vm.expectRevert(bytes("input hash mismatch"));
        marketplace.verifyAndConsumeReceipt(receiptId, keccak256("tampered"));
    }

    function test_VerifyAndConsume_RevertsForUnknownReceipt() public {
        vm.prank(alice);
        vm.expectRevert(bytes("no receipt"));
        marketplace.verifyAndConsumeReceipt(keccak256("never-paid"), keccak256("x"));
    }
}
