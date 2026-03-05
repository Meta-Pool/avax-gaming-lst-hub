// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockVotingPowerReader {
    mapping(address => uint256) private _votingPower;
    uint256 public totalVotingPower;

    function setVotingPower(address account, uint256 value) external {
        totalVotingPower = totalVotingPower - _votingPower[account] + value;
        _votingPower[account] = value;
    }

    function getVotingPower(address account) external view returns (uint256) {
        return _votingPower[account];
    }
}
