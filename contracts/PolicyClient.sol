// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "./vendor/openzeppelin/access/Ownable.sol";
import {ITeleporterMessenger} from "./interfaces/ITeleporterMessenger.sol";
import {MessageFormatV1} from "./libraries/MessageFormatV1.sol";

contract PolicyClient is Ownable {
    uint16 public constant BPS_DENOMINATOR = 10_000;

    error ZeroAddress();
    error NotTeleporterMessenger(address caller);
    error InvalidPolicySource(uint256 chainId, address sender);
    error InvalidPolicyLength(uint256 validatorsLen, uint256 weightsLen);
    error InvalidPolicySum(uint256 sumBps);
    error PolicyAlreadyStored(uint256 epoch);
    error NoFallbackPolicy();
    error RequestTargetNotSet();

    address public immutable teleporterMessenger;

    uint256 public requestTargetChainId;
    address public requestTargetSender;

    uint256 public lastKnownEpoch;

    mapping(uint256 => mapping(address => bool)) public allowedPolicySources;

    mapping(uint256 => bool) public hasPolicyForEpoch;
    mapping(uint256 => uint256[]) private _policyValidatorIdsByEpoch;
    mapping(uint256 => uint16[]) private _policyWeightsByEpoch;

    uint256[] private _lastKnownValidatorIds;
    uint16[] private _lastKnownWeightsBps;

    event PolicyRequested(
        uint256 indexed epoch,
        address indexed requester,
        address indexed vaultAddress,
        bytes32 messageId
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

    event PolicySourceSet(
        uint256 indexed chainId,
        address indexed sender,
        bool allowed
    );

    event RequestTargetSet(uint256 indexed chainId, address indexed sender);

    constructor(address teleporterMessenger_, address owner_) Ownable(owner_) {
        if (teleporterMessenger_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }

        teleporterMessenger = teleporterMessenger_;
    }

    function setAllowedPolicySource(
        uint256 chainId,
        address sender,
        bool allowed
    ) external onlyOwner {
        if (sender == address(0)) {
            revert ZeroAddress();
        }

        allowedPolicySources[chainId][sender] = allowed;
        emit PolicySourceSet(chainId, sender, allowed);
    }

    function setRequestTarget(uint256 chainId, address sender) external onlyOwner {
        if (sender == address(0)) {
            revert ZeroAddress();
        }

        requestTargetChainId = chainId;
        requestTargetSender = sender;
        emit RequestTargetSet(chainId, sender);
    }

    function requestPolicy(uint256 epoch) external returns (bytes32) {
        return requestPolicy(epoch, address(0));
    }

    function requestPolicy(
        uint256 epoch,
        address vaultAddress
    ) public returns (bytes32 messageId) {
        if (requestTargetSender == address(0)) {
            revert RequestTargetNotSet();
        }

        bytes memory requestPayload = MessageFormatV1.encodeRequestPolicy(
            MessageFormatV1.RequestPolicy({
                epoch: epoch,
                requester: msg.sender,
                vaultAddress: vaultAddress
            })
        );

        messageId = ITeleporterMessenger(teleporterMessenger).sendCrossChainMessage(
            requestTargetChainId,
            requestTargetSender,
            requestPayload
        );

        emit PolicyRequested(epoch, msg.sender, vaultAddress, messageId);
    }

    function onTeleporterMessage(
        uint256 originChainId,
        address originSender,
        bytes calldata payload
    ) external {
        _checkMessenger();

        if (!allowedPolicySources[originChainId][originSender]) {
            revert InvalidPolicySource(originChainId, originSender);
        }

        MessageFormatV1.PolicyResponse memory response = MessageFormatV1
            .decodePolicyResponse(payload);

        _storePolicy(response.epoch, response.validatorIds, response.weightsBps);

        emit PolicyReceived(response.epoch, originChainId, originSender);
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
        uint256 epoch,
        uint256[] memory validatorIds,
        uint16[] memory weightBps
    ) internal {
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
    }
}
