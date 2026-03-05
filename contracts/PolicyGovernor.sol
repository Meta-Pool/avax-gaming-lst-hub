// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IVotingPowerReader {
    function getVotingPower(address account) external view returns (uint256);

    function totalVotingPower() external view returns (uint256);
}

contract PolicyGovernor {
    uint16 public constant BPS_DENOMINATOR = 10_000;

    enum QuorumMode {
        ABSOLUTE,
        BPS
    }

    struct ValidatorWeight {
        uint256 validatorId;
        uint16 weightBps;
    }

    error InvalidEpochSeconds();
    error InvalidVotingPowerAddress();
    error InvalidQuorumValue();
    error InvalidValidatorSet();
    error InvalidWeightsLength(uint256 expected, uint256 provided);
    error InvalidWeightsSum(uint256 sumBps);
    error NoVotingPower(address voter);
    error AlreadyVoted(uint256 epoch, address voter);
    error EpochAlreadyFinalized(uint256 epoch);
    error EpochNotFinalized(uint256 epoch);
    error QuorumNotReached(uint256 epoch, uint256 got, uint256 required);

    event Voted(
        uint256 indexed epoch,
        address indexed voter,
        uint256 votingPower,
        uint16[] weightsBps
    );

    event EpochFinalized(
        uint256 indexed epoch,
        uint256 totalVotingPower,
        uint16[] weightsBps
    );

    IVotingPowerReader public immutable votingPower;
    uint256 public immutable EPOCH_SECONDS;
    uint256 public immutable START_TIMESTAMP;
    QuorumMode public immutable quorumMode;
    uint256 public immutable quorumValue;

    uint256[] private _validatorIds;

    mapping(uint256 => bool) public isEpochFinalized;
    mapping(uint256 => uint16[]) private _finalizedWeightsByEpoch;
    mapping(uint256 => uint256) public totalVotingPowerByEpoch;
    mapping(uint256 => uint256) public votersByEpoch;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(uint256 => uint256)) private _aggregatedWeightPowerByEpoch;

    uint256 private _latestFinalizedEpoch;

    constructor(
        address votingPowerAddress_,
        uint256 epochSeconds_,
        bool useQuorumBps_,
        uint256 quorumValue_,
        uint256[] memory validatorIds_
    ) {
        if (votingPowerAddress_ == address(0)) {
            revert InvalidVotingPowerAddress();
        }
        if (epochSeconds_ == 0) {
            revert InvalidEpochSeconds();
        }
        if (quorumValue_ == 0) {
            revert InvalidQuorumValue();
        }

        if (useQuorumBps_ && quorumValue_ > BPS_DENOMINATOR) {
            revert InvalidQuorumValue();
        }

        EPOCH_SECONDS = epochSeconds_;
        START_TIMESTAMP = block.timestamp;
        votingPower = IVotingPowerReader(votingPowerAddress_);
        quorumMode = useQuorumBps_ ? QuorumMode.BPS : QuorumMode.ABSOLUTE;
        quorumValue = quorumValue_;

        if (validatorIds_.length == 0) {
            _validatorIds.push(1);
            _validatorIds.push(2);
            _validatorIds.push(3);
            _validatorIds.push(4);
        } else {
            for (uint256 i = 0; i < validatorIds_.length; i += 1) {
                _validatorIds.push(validatorIds_[i]);
            }
        }

        if (_validatorIds.length == 0) {
            revert InvalidValidatorSet();
        }
    }

    function getCurrentEpoch() public view returns (uint256) {
        return ((block.timestamp - START_TIMESTAMP) / EPOCH_SECONDS) + 1;
    }

    function getLatestFinalizedEpoch() external view returns (uint256) {
        return _latestFinalizedEpoch;
    }

    function getValidatorIds() external view returns (uint256[] memory) {
        return _validatorIds;
    }

    function vote(uint16[] calldata weightsBps) external {
        uint256 epoch = getCurrentEpoch();

        if (isEpochFinalized[epoch]) {
            revert EpochAlreadyFinalized(epoch);
        }

        uint256 validatorsLen = _validatorIds.length;
        if (weightsBps.length != validatorsLen) {
            revert InvalidWeightsLength(validatorsLen, weightsBps.length);
        }

        if (hasVoted[epoch][msg.sender]) {
            revert AlreadyVoted(epoch, msg.sender);
        }

        uint256 voterVp = votingPower.getVotingPower(msg.sender);
        if (voterVp == 0) {
            revert NoVotingPower(msg.sender);
        }

        uint256 sum;
        for (uint256 i = 0; i < validatorsLen; i += 1) {
            uint16 weight = weightsBps[i];
            sum += weight;
            _aggregatedWeightPowerByEpoch[epoch][i] += uint256(weight) * voterVp;
        }

        if (sum != BPS_DENOMINATOR) {
            revert InvalidWeightsSum(sum);
        }

        hasVoted[epoch][msg.sender] = true;
        votersByEpoch[epoch] += 1;
        totalVotingPowerByEpoch[epoch] += voterVp;

        emit Voted(epoch, msg.sender, voterVp, weightsBps);
    }

    function finalizeCurrentEpoch() external {
        finalizeEpoch(getCurrentEpoch());
    }

    function finalizeEpoch(uint256 epoch) public {
        if (isEpochFinalized[epoch]) {
            revert EpochAlreadyFinalized(epoch);
        }

        uint256 participatedVp = totalVotingPowerByEpoch[epoch];
        uint256 requiredVp = _requiredQuorumVotingPower();
        if (participatedVp < requiredVp) {
            revert QuorumNotReached(epoch, participatedVp, requiredVp);
        }

        uint16[] memory weights = _computeFinalWeights(epoch, participatedVp);
        isEpochFinalized[epoch] = true;

        uint16[] storage stored = _finalizedWeightsByEpoch[epoch];
        for (uint256 i = 0; i < weights.length; i += 1) {
            stored.push(weights[i]);
        }

        if (epoch > _latestFinalizedEpoch) {
            _latestFinalizedEpoch = epoch;
        }

        emit EpochFinalized(epoch, participatedVp, weights);
    }

    function getPolicy(
        uint256 epoch
    ) external view returns (ValidatorWeight[] memory policy) {
        if (!isEpochFinalized[epoch]) {
            revert EpochNotFinalized(epoch);
        }

        uint256 validatorsLen = _validatorIds.length;
        policy = new ValidatorWeight[](validatorsLen);
        uint16[] storage weights = _finalizedWeightsByEpoch[epoch];

        for (uint256 i = 0; i < validatorsLen; i += 1) {
            policy[i] = ValidatorWeight({
                validatorId: _validatorIds[i],
                weightBps: weights[i]
            });
        }
    }

    function _requiredQuorumVotingPower() internal view returns (uint256) {
        if (quorumMode == QuorumMode.ABSOLUTE) {
            return quorumValue;
        }

        uint256 totalVp = votingPower.totalVotingPower();
        if (totalVp == 0) {
            return type(uint256).max;
        }

        uint256 requiredVp = (totalVp * quorumValue + BPS_DENOMINATOR - 1) /
            BPS_DENOMINATOR;
        return requiredVp;
    }

    function _computeFinalWeights(
        uint256 epoch,
        uint256 participatedVp
    ) internal view returns (uint16[] memory weights) {
        uint256 validatorsLen = _validatorIds.length;
        weights = new uint16[](validatorsLen);

        uint256 sum;
        uint256 maxIdx;
        uint256 maxValue;

        for (uint256 i = 0; i < validatorsLen; i += 1) {
            uint256 aggregate = _aggregatedWeightPowerByEpoch[epoch][i];
            uint256 weight = (aggregate * BPS_DENOMINATOR) / participatedVp;
            weights[i] = uint16(weight);
            sum += weight;

            if (aggregate > maxValue) {
                maxValue = aggregate;
                maxIdx = i;
            }
        }

        if (sum != BPS_DENOMINATOR) {
            weights[maxIdx] += uint16(BPS_DENOMINATOR - sum);
        }
    }
}
