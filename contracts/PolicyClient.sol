// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ITeleporterMessenger} from "./interfaces/ITeleporterMessenger.sol";

contract PolicyClient {
    uint16 public constant BPS_DENOMINATOR = 10_000;

    error ZeroAddress();
    error NotTeleporterMessenger(address caller);
    error InvalidPolicySource(uint256 chainId, address sender);
    error InvalidPolicyLength(uint256 validatorsLen, uint256 weightsLen);
    error InvalidPolicySum(uint256 sumBps);
    error PolicyAlreadyStored(uint256 epoch);
    error NoFallbackPolicy();

    address public immutable teleporterMessenger;
    uint256 public immutable sourceChainId;
    address public immutable sourcePolicySender;

    uint256 public lastKnownEpoch;

    mapping(uint256 => bool) public hasPolicyForEpoch;
    mapping(uint256 => uint256[]) private _policyValidatorIdsByEpoch;
    mapping(uint256 => uint16[]) private _policyWeightsByEpoch;

    uint256[] private _lastKnownValidatorIds;
    uint16[] private _lastKnownWeightsBps;

    event PolicyRequested(
        uint256 indexed epoch,
        address indexed requester,
        bytes32 indexed messageId
    );

    event PolicyReceived(
        uint256 indexed epoch,
        uint256 indexed originChainId,
        address indexed originSender
    );

    event PolicyFallbackUsed(
        uint256 indexed requestedEpoch,
        uint256 indexed fallbackEpoch,
        address indexed caller
    );

    constructor(
        address teleporterMessenger_,
        uint256 sourceChainId_,
        address sourcePolicySender_
    ) {
        if (teleporterMessenger_ == address(0) || sourcePolicySender_ == address(0)) {
            revert ZeroAddress();
        }

        teleporterMessenger = teleporterMessenger_;
        sourceChainId = sourceChainId_;
        sourcePolicySender = sourcePolicySender_;
    }

    function requestPolicy(uint256 epoch) external returns (bytes32 messageId) {
        // Request payload can be routed/decoded by the C-Chain responder.
        bytes memory requestPayload = abi.encode(epoch);

        messageId = ITeleporterMessenger(teleporterMessenger).sendCrossChainMessage(
            sourceChainId,
            sourcePolicySender,
            requestPayload
        );

        emit PolicyRequested(epoch, msg.sender, messageId);
    }

    function onTeleporterMessage(
        uint256 originChainId,
        address originSender,
        bytes calldata payload
    ) external {
        _checkMessenger();

        (
            uint256 epoch,
            uint256[] memory validatorIds,
            uint16[] memory weightBps
        ) = abi.decode(payload, (uint256, uint256[], uint16[]));

        _storePolicy(originChainId, originSender, epoch, validatorIds, weightBps);
    }

    function onPolicyResponse(
        uint256 originChainId,
        address originSender,
        uint256 epoch,
        uint256[] calldata validatorIds,
        uint16[] calldata weightBps
    ) external {
        _checkMessenger();
        _storePolicy(originChainId, originSender, epoch, validatorIds, weightBps);
    }

    function getPolicy(
        uint256 epoch
    ) external view returns (uint256[] memory validatorIds, uint16[] memory weightBps) {
        if (!hasPolicyForEpoch[epoch]) {
            return (new uint256[](0), new uint16[](0));
        }

        return (_policyValidatorIdsByEpoch[epoch], _policyWeightsByEpoch[epoch]);
    }

    function getLastKnownPolicy()
        external
        view
        returns (uint256 epoch, uint256[] memory validatorIds, uint16[] memory weightBps)
    {
        return (lastKnownEpoch, _lastKnownValidatorIds, _lastKnownWeightsBps);
    }

    function getPolicyOrFallback(
        uint256 epoch
    )
        external
        returns (
            uint256 policyEpoch,
            uint256[] memory validatorIds,
            uint16[] memory weightBps,
            bool usedFallback
        )
    {
        if (hasPolicyForEpoch[epoch]) {
            return (epoch, _policyValidatorIdsByEpoch[epoch], _policyWeightsByEpoch[epoch], false);
        }

        if (lastKnownEpoch == 0) {
            revert NoFallbackPolicy();
        }

        emit PolicyFallbackUsed(epoch, lastKnownEpoch, msg.sender);
        return (lastKnownEpoch, _lastKnownValidatorIds, _lastKnownWeightsBps, true);
    }

    function _checkMessenger() internal view {
        if (msg.sender != teleporterMessenger) {
            revert NotTeleporterMessenger(msg.sender);
        }
    }

    function _storePolicy(
        uint256 originChainId,
        address originSender,
        uint256 epoch,
        uint256[] memory validatorIds,
        uint16[] memory weightBps
    ) internal {
        if (originChainId != sourceChainId || originSender != sourcePolicySender) {
            revert InvalidPolicySource(originChainId, originSender);
        }

        if (hasPolicyForEpoch[epoch]) {
            revert PolicyAlreadyStored(epoch);
        }

        uint256 validatorsLen = validatorIds.length;
        if (validatorsLen == 0 || validatorsLen != weightBps.length) {
            revert InvalidPolicyLength(validatorsLen, weightBps.length);
        }

        uint256 sumBps;
        for (uint256 i = 0; i < validatorsLen; i += 1) {
            _policyValidatorIdsByEpoch[epoch].push(validatorIds[i]);
            _policyWeightsByEpoch[epoch].push(weightBps[i]);
            sumBps += weightBps[i];
        }

        if (sumBps != BPS_DENOMINATOR) {
            revert InvalidPolicySum(sumBps);
        }

        hasPolicyForEpoch[epoch] = true;
        lastKnownEpoch = epoch;

        delete _lastKnownValidatorIds;
        delete _lastKnownWeightsBps;

        for (uint256 i = 0; i < validatorsLen; i += 1) {
            _lastKnownValidatorIds.push(validatorIds[i]);
            _lastKnownWeightsBps.push(weightBps[i]);
        }

        emit PolicyReceived(epoch, originChainId, originSender);
    }
}
