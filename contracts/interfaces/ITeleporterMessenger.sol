// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITeleporterMessenger {
    function sendCrossChainMessage(
        uint256 destinationChainId,
        address destinationAddress,
        bytes calldata message
    ) external returns (bytes32 messageId);
}
