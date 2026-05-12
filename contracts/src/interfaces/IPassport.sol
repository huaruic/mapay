// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPassport — minimal surface Marketplace needs from Passport.
interface IPassport {
    function mint(address to, uint256 agentId) external returns (uint256 tokenId);
    function appendTask(uint256 tokenId, bytes32 taskId) external;
    function updateReputation(uint256 tokenId, uint16 newReputation) external;
    function tokenIdOf(uint256 agentId) external view returns (uint256);
}
