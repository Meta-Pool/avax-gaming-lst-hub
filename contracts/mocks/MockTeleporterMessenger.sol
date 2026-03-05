// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "../vendor/openzeppelin/access/Ownable.sol";
import {ITeleporterMessenger} from "../interfaces/ITeleporterMessenger.sol";

contract MockTeleporterMessenger is Ownable, ITeleporterMessenger {
    uint256 private _nonce;

    event CrossChainMessageSent(
        bytes32 indexed messageId,
        uint256 indexed sourceChainId,
        address indexed sourceSender,
        uint256 destinationChainId,
        address destinationAddress,
        bytes message
    );

    event MessageRelayed(
        address indexed target,
        uint256 indexed originChainId,
        address indexed originSender,
        bytes payload
    );

    constructor(address owner_) Ownable(owner_) {}

    function sendCrossChainMessage(
        uint256 destinationChainId,
        address destinationAddress,
        bytes calldata message
    ) external override returns (bytes32 messageId) {
        messageId = keccak256(
            abi.encodePacked(
                block.chainid,
                msg.sender,
                destinationChainId,
                destinationAddress,
                message,
                _nonce
            )
        );
        _nonce += 1;

        emit CrossChainMessageSent(
            messageId,
            block.chainid,
            msg.sender,
            destinationChainId,
            destinationAddress,
            message
        );
    }

    function relayMessage(
        address target,
        uint256 originChainId,
        address originSender,
        bytes calldata payload
    ) external onlyOwner {
        (bool ok, bytes memory reason) = target.call(
            abi.encodeWithSignature(
                "onTeleporterMessage(uint256,address,bytes)",
                originChainId,
                originSender,
                payload
            )
        );

        if (!ok) {
            assembly {
                revert(add(reason, 0x20), mload(reason))
            }
        }

        emit MessageRelayed(target, originChainId, originSender, payload);
    }
}
