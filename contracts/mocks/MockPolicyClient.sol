// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockPolicyClient {
    uint16 public constant BPS_DENOMINATOR = 10_000;

    error InvalidPolicyLength();
    error InvalidPolicySum(uint256 sumBps);
    error NoFallbackPolicy();

    uint256 public lastKnownEpoch;

    mapping(uint256 => bool) public hasPolicyForEpoch;
    mapping(uint256 => uint256[]) private _policyValidatorIdsByEpoch;
    mapping(uint256 => uint16[]) private _policyWeightsByEpoch;

    uint256[] private _lastKnownValidatorIds;
    uint16[] private _lastKnownWeightsBps;

    event PolicySet(uint256 indexed epoch);
    event PolicyFallbackUsed(
        uint256 indexed requestedEpoch,
        uint256 indexed fallbackEpoch
    );

    function setPolicy(
        uint256 epoch,
        uint256[] calldata validatorIds,
        uint16[] calldata weightsBps
    ) external {
        if (
            validatorIds.length == 0 || validatorIds.length != weightsBps.length
        ) {
            revert InvalidPolicyLength();
        }

        uint256 sum;
        delete _policyValidatorIdsByEpoch[epoch];
        delete _policyWeightsByEpoch[epoch];

        for (uint256 i = 0; i < validatorIds.length; i += 1) {
            _policyValidatorIdsByEpoch[epoch].push(validatorIds[i]);
            _policyWeightsByEpoch[epoch].push(weightsBps[i]);
            sum += weightsBps[i];
        }

        if (sum != BPS_DENOMINATOR) {
            revert InvalidPolicySum(sum);
        }

        hasPolicyForEpoch[epoch] = true;
        lastKnownEpoch = epoch;

        delete _lastKnownValidatorIds;
        delete _lastKnownWeightsBps;

        for (uint256 i = 0; i < validatorIds.length; i += 1) {
            _lastKnownValidatorIds.push(validatorIds[i]);
            _lastKnownWeightsBps.push(weightsBps[i]);
        }

        emit PolicySet(epoch);
    }

    function getPolicy(
        uint256 epoch
    )
        external
        view
        returns (uint256[] memory validatorIds, uint16[] memory weightBps)
    {
        if (!hasPolicyForEpoch[epoch]) {
            return (new uint256[](0), new uint16[](0));
        }

        return (
            _policyValidatorIdsByEpoch[epoch],
            _policyWeightsByEpoch[epoch]
        );
    }

    function getLastKnownPolicy()
        external
        view
        returns (
            uint256 epoch,
            uint256[] memory validatorIds,
            uint16[] memory weightBps
        )
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
            uint16[] memory weightsBps,
            bool usedFallback
        )
    {
        if (hasPolicyForEpoch[epoch]) {
            return (
                epoch,
                _policyValidatorIdsByEpoch[epoch],
                _policyWeightsByEpoch[epoch],
                false
            );
        }

        if (lastKnownEpoch == 0) {
            revert NoFallbackPolicy();
        }

        emit PolicyFallbackUsed(epoch, lastKnownEpoch);
        return (
            lastKnownEpoch,
            _lastKnownValidatorIds,
            _lastKnownWeightsBps,
            true
        );
    }
}
