// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "./vendor/openzeppelin/access/Ownable.sol";
import {ITeleporterMessenger} from "./interfaces/ITeleporterMessenger.sol";
import {MessageFormatV1} from "./libraries/MessageFormatV1.sol";

interface IPolicyGovernorReader {
    struct ValidatorWeight {
        uint256 validatorId;
        uint16 weightBps;
    }

    function getPolicy(
        uint256 epoch
    ) external view returns (ValidatorWeight[] memory policy);
}

contract PolicyServer is Ownable {
    uint16 public constant BPS_DENOMINATOR = 10_000;

    error ZeroAddress();
    error NotTeleporterMessenger(address caller);
    error InvalidRequestSource(uint256 chainId, address sender);
    error InvalidPolicySum(uint256 sumBps);
    error InvalidPolicyLength();

    address public immutable teleporterMessenger;
    IPolicyGovernorReader public immutable policyGovernor;

    mapping(uint256 => mapping(address => bool)) public allowedRequestSources;

    event RequestSourceSet(
        uint256 indexed chainId,
        address indexed sender,
        bool allowed
    );

    event PolicyRequestHandled(
        uint256 indexed epoch,
        uint256 indexed originChainId,
        address indexed originSender,
        address requester,
        address vaultAddress,
        bytes32 responseMessageId
    );

    constructor(
        address teleporterMessenger_,
        address policyGovernor_,
        address owner_
    ) Ownable(owner_) {
        if (
            teleporterMessenger_ == address(0) ||
            policyGovernor_ == address(0) ||
            owner_ == address(0)
        ) {
            revert ZeroAddress();
        }

        teleporterMessenger = teleporterMessenger_;
        policyGovernor = IPolicyGovernorReader(policyGovernor_);
    }

    function setAllowedRequestSource(
        uint256 chainId,
        address sender,
        bool allowed
    ) external onlyOwner {
        if (sender == address(0)) {
            revert ZeroAddress();
        }

        allowedRequestSources[chainId][sender] = allowed;
        emit RequestSourceSet(chainId, sender, allowed);
    }

    function onTeleporterMessage(
        uint256 originChainId,
        address originSender,
        bytes calldata payload
    ) external {
        _checkMessenger();

        if (!allowedRequestSources[originChainId][originSender]) {
            revert InvalidRequestSource(originChainId, originSender);
        }

        MessageFormatV1.RequestPolicy memory request = MessageFormatV1.decodeRequestPolicy(
            payload
        );

        IPolicyGovernorReader.ValidatorWeight[] memory policy = policyGovernor.getPolicy(
            request.epoch
        );

        if (policy.length == 0) {
            revert InvalidPolicyLength();
        }

        uint256[] memory validatorIds = new uint256[](policy.length);
        uint16[] memory weightsBps = new uint16[](policy.length);

        uint256 sumBps;
        for (uint256 i = 0; i < policy.length; i += 1) {
            validatorIds[i] = policy[i].validatorId;
            weightsBps[i] = policy[i].weightBps;
            sumBps += policy[i].weightBps;
        }

        if (sumBps != BPS_DENOMINATOR) {
            revert InvalidPolicySum(sumBps);
        }

        bytes memory responsePayload = MessageFormatV1.encodePolicyResponse(
            MessageFormatV1.PolicyResponse({
                epoch: request.epoch,
                validatorIds: validatorIds,
                weightsBps: weightsBps
            })
        );

        bytes32 messageId = ITeleporterMessenger(teleporterMessenger).sendCrossChainMessage(
            originChainId,
            originSender,
            responsePayload
        );

        emit PolicyRequestHandled(
            request.epoch,
            originChainId,
            originSender,
            request.requester,
            request.vaultAddress,
            messageId
        );
    }

    function _checkMessenger() internal view {
        if (msg.sender != teleporterMessenger) {
            revert NotTeleporterMessenger(msg.sender);
        }
    }
}
