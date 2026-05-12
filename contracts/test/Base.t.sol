// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Passport} from "../src/Passport.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @dev Shared deployment + actor cast. Each concrete *.t.sol does its own
///      scenario setup on top.
abstract contract Base is Test {
    Passport internal passport;
    Marketplace internal marketplace;

    address internal deployer = makeAddr("deployer");
    address internal alice = makeAddr("alice"); // provider
    address internal bob = makeAddr("bob"); // provider 2
    address internal charlie = makeAddr("charlie"); // end user / agent owner
    address internal dave = makeAddr("dave"); // operator (Worker key)
    address internal eve = makeAddr("eve"); // adversary

    address internal alicePayout = makeAddr("alice-payout");
    address internal bobPayout = makeAddr("bob-payout");

    function setUp() public virtual {
        vm.prank(deployer);
        passport = new Passport();

        vm.prank(deployer);
        marketplace = new Marketplace(address(passport));

        vm.prank(deployer);
        passport.setMarketplace(address(marketplace));

        // Fund actors so they can pay msg.value
        vm.deal(charlie, 1000 ether);
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
        vm.deal(eve, 1 ether);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _registerTool(address provider, address payout, uint128 price)
        internal
        returns (uint256 toolId)
    {
        vm.prank(provider);
        toolId = marketplace.registerTool(
            "https://provider.example/tool",
            keccak256("schema-v1"),
            price,
            "Test Tool",
            "A test tool.",
            payout
        );
    }

    function _createAgent(
        address owner,
        address operator,
        uint128 maxPerCall,
        uint128 dailyCap,
        uint256 fund
    ) internal returns (uint256 agentId) {
        vm.deal(owner, owner.balance + fund);
        vm.prank(owner);
        agentId = marketplace.createAndFundAgent{value: fund}(
            maxPerCall,
            dailyCap,
            operator,
            "agent",
            "do stuff"
        );
    }

    function _startTask(address operator, uint256 agentId, bytes32 promptHash, bytes32 salt)
        internal
        returns (bytes32 taskId)
    {
        vm.prank(operator);
        taskId = marketplace.startTask(agentId, promptHash, salt);
    }
}
