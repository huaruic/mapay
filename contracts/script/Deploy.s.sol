// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {Passport} from "../src/Passport.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @title Deploy — Passport first, then Marketplace, then wire them.
contract Deploy is Script {
    function run() external returns (Passport passport, Marketplace marketplace) {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk != 0) {
            vm.startBroadcast(pk);
        } else {
            vm.startBroadcast();
        }

        passport = new Passport();
        marketplace = new Marketplace(address(passport));
        passport.setMarketplace(address(marketplace));

        vm.stopBroadcast();

        console2.log("Passport:    ", address(passport));
        console2.log("Marketplace: ", address(marketplace));
    }
}
