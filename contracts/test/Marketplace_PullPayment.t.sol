// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base} from "./Base.t.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @dev Reentrancy attacker contract for the pull-payment guard test.
contract ReentrantPayout {
    Marketplace public marketplace;
    uint256 public attempts;

    constructor(Marketplace m) {
        marketplace = m;
    }

    function attack() external {
        // First call: should succeed and trigger receive() which tries again
        marketplace.withdrawProvider(1);
    }

    receive() external payable {
        attempts++;
        // Try a second nested withdraw — must be blocked by nonReentrant
        if (attempts < 5) {
            marketplace.withdrawProvider(1);
        }
    }
}

/// @title Marketplace_PullPayment — Spec Requirement: "Pull-Payment 模型"
contract Marketplace_PullPayment is Base {
    event ProviderWithdrawn(address indexed provider, uint256 amount);

    function _setupOnePaidCall(address operator, uint256 fund, uint128 price)
        internal
        returns (uint256 toolId, uint256 agentId, bytes32 taskId, bytes32 receiptId)
    {
        toolId = _registerTool(alice, alicePayout, price);
        agentId = _createAgent(charlie, operator, price, price * 10, fund);
        taskId = _startTask(operator, agentId, keccak256("prompt"), bytes32(uint256(1)));
        vm.prank(operator);
        (receiptId, ) = marketplace.pay(taskId, toolId, 1, price, keccak256("body"));
    }

    function test_PayCreditsProviderLedger_AndDoesNotTransferImmediately() public {
        uint128 price = 0.05 ether;
        _setupOnePaidCall(dave, 1 ether, price);

        assertEq(marketplace.providerBalances(alicePayout), price, "ledger credited");
        // No MON has moved out of the contract:
        assertEq(address(marketplace).balance, 1 ether, "funds remain escrowed");
        assertEq(alicePayout.balance, 0, "payout untouched until withdraw");
    }

    function test_ProviderWithdrawsSuccessfully_CEI_AndEvent() public {
        uint128 price = 0.05 ether;
        _setupOnePaidCall(dave, 1 ether, price);

        // Set alicePayout to be a plain EOA (already an EOA via makeAddr).
        vm.expectEmit(true, false, false, true);
        emit ProviderWithdrawn(alicePayout, price);

        vm.prank(alicePayout);
        marketplace.withdrawProvider(price);

        assertEq(marketplace.providerBalances(alicePayout), 0, "ledger zeroed");
        assertEq(alicePayout.balance, price, "EOA paid out");
    }

    function test_WithdrawReverts_WhenAmountExceedsBalance() public {
        uint128 price = 0.05 ether;
        _setupOnePaidCall(dave, 1 ether, price);

        vm.prank(alicePayout);
        vm.expectRevert(bytes("insufficient balance"));
        marketplace.withdrawProvider(price + 1);
    }

    function test_WithdrawPartial_LeavesRemainder() public {
        uint128 price = 0.10 ether;
        _setupOnePaidCall(dave, 1 ether, price);

        vm.prank(alicePayout);
        marketplace.withdrawProvider(0.03 ether);

        assertEq(marketplace.providerBalances(alicePayout), 0.07 ether, "remainder");
        assertEq(alicePayout.balance, 0.03 ether, "paid 0.03");
    }

    function test_Withdraw_BlocksReentrancy() public {
        // Register a tool whose payout is the malicious contract.
        ReentrantPayout attacker = new ReentrantPayout(marketplace);
        uint128 price = 0.05 ether;

        uint256 toolId = _registerTool(alice, address(attacker), price);
        uint256 agentId = _createAgent(charlie, dave, price, price * 10, 1 ether);
        bytes32 taskId = _startTask(dave, agentId, keccak256("p"), bytes32(uint256(1)));
        vm.prank(dave);
        marketplace.pay(taskId, toolId, 1, price, keccak256("body"));

        // Attacker tries withdraw which calls receive() which tries withdraw again.
        // The outer call must revert because the inner reentry triggers nonReentrant,
        // which makes `.call{value:..}` return false, which bubbles "transfer failed".
        vm.expectRevert(bytes("transfer failed"));
        attacker.attack();

        // Ledger preserved (CEI: effect was rolled back by outer revert).
        assertEq(marketplace.providerBalances(address(attacker)), price, "balance preserved");
    }
}
