// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract PingReceiver {
    error ZeroAddress();
    error NotTeleporterMessenger(address caller);

    address public immutable teleporterMessenger;
    uint256 public totalReceived;
    bytes32 public lastPayloadHash;
    uint256 public lastOriginChainId;
    address public lastOriginSender;

    mapping(uint256 => uint256) public receivedBySourceChain;

    event PingReceived(
        uint256 indexed originChainId,
        address indexed originSender,
        uint256 indexed totalCount,
        bytes32 payloadHash,
        bytes payload
    );

    modifier onlyMessenger() {
        if (msg.sender != teleporterMessenger) {
            revert NotTeleporterMessenger(msg.sender);
        }
        _;
    }

    constructor(address messenger_) {
        if (messenger_ == address(0)) {
            revert ZeroAddress();
        }
        teleporterMessenger = messenger_;
    }

    function onTeleporterMessage(
        uint256 originChainId,
        address originSender,
        bytes calldata payload
    ) external onlyMessenger {
        _recordMessage(originChainId, originSender, payload);
    }

    function handleMessage(
        uint256 originChainId,
        address originSender,
        bytes calldata payload
    ) external onlyMessenger {
        _recordMessage(originChainId, originSender, payload);
    }

    function _recordMessage(
        uint256 originChainId,
        address originSender,
        bytes calldata payload
    ) internal {
        totalReceived += 1;
        lastPayloadHash = keccak256(payload);
        lastOriginChainId = originChainId;
        lastOriginSender = originSender;
        receivedBySourceChain[originChainId] += 1;

        emit PingReceived(
            originChainId,
            originSender,
            totalReceived,
            lastPayloadHash,
            payload
        );
    }
}
