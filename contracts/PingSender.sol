// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITeleporterMessenger} from "./interfaces/ITeleporterMessenger.sol";

contract PingSender {
    error ZeroAddress();

    address public immutable teleporterMessenger;

    event PingSent(
        address indexed caller,
        uint256 indexed destinationChainId,
        address indexed destinationReceiver,
        bytes32 payloadHash,
        bytes32 messageId,
        bytes payload
    );

    constructor(address messenger_) {
        if (messenger_ == address(0)) {
            revert ZeroAddress();
        }
        teleporterMessenger = messenger_;
    }

    function sendPing(
        uint256 destinationChainId,
        address destinationReceiver,
        bytes calldata payload
    ) external returns (bytes32 messageId) {
        if (destinationReceiver == address(0)) {
            revert ZeroAddress();
        }

        messageId = ITeleporterMessenger(teleporterMessenger).sendCrossChainMessage(
            destinationChainId,
            destinationReceiver,
            payload
        );

        emit PingSent(
            msg.sender,
            destinationChainId,
            destinationReceiver,
            keccak256(payload),
            messageId,
            payload
        );
    }
}
