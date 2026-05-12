// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {Passport} from "../src/Passport.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @title DeployLocal — local Anvil deploy script.
/// @notice Identical wiring sequence to the production `Deploy.s.sol`:
///         (1) deploy Passport, (2) deploy Marketplace with passport addr,
///         (3) call `Passport.setMarketplace(marketplaceAddr)` so only the
///         Marketplace contract can mint Passport tokens.
///
///         Reads `PRIVATE_KEY` from env if provided; otherwise falls back to
///         Anvil's default account 0 (matches `scripts/deploy-local.sh`).
///
///         Deployed addresses are emitted via `console2.log` and additionally
///         parsed from Foundry's broadcast JSON by the wrapper shell script.
contract DeployLocal is Script {
    /// @dev Default Anvil account 0 private key. Public, well-known testing key.
    uint256 internal constant ANVIL_DEFAULT_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external returns (Passport passport, Marketplace marketplace) {
        uint256 pk = vm.envOr("PRIVATE_KEY", ANVIL_DEFAULT_PK);
        vm.startBroadcast(pk);

        passport = new Passport();
        marketplace = new Marketplace(address(passport));
        passport.setMarketplace(address(marketplace));

        vm.stopBroadcast();

        console2.log("Passport:    ", address(passport));
        console2.log("Marketplace: ", address(marketplace));
    }
}
