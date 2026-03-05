// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "./vendor/openzeppelin/token/ERC20/IERC20.sol";
import {ERC4626} from "./vendor/openzeppelin/token/ERC20/extensions/ERC4626.sol";
import {Ownable} from "./vendor/openzeppelin/access/Ownable.sol";
import {SafeERC20} from "./vendor/openzeppelin/token/ERC20/utils/SafeERC20.sol";

interface IPolicyClientReader {
    function getPolicyOrFallback(
        uint256 epoch
    )
        external
        returns (
            uint256 policyEpoch,
            uint256[] memory validatorIds,
            uint16[] memory weightBps,
            bool usedFallback
        );
}

contract StBEAMVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public immutable DEPOSIT_FEE_BPS;

    uint256 public immutable POLICY_EPOCH_SECONDS;
    uint256 public immutable POLICY_START_TIMESTAMP;

    address public policyClient;

    // Tracks which applicable epoch was last resolved, and what policy epoch was used.
    uint256 public lastPolicyRequestEpoch;
    uint256 public currentPolicyEpoch;

    // Accumulated fees denominated in the underlying asset (not in shares).
    uint256 public feeAccumulator;

    // Simulated validator buckets: bucket amount per validatorId.
    mapping(uint256 => uint256) public bucket;

    uint256[] private _bucketValidatorIds;
    mapping(uint256 => bool) private _knownBucket;

    uint256[] private _currentPolicyValidatorIds;
    uint16[] private _currentPolicyWeightsBps;

    error InvalidDepositFeeBps();
    error InvalidAmount();
    error InsufficientFeeBalance();
    error InvalidEpochConfig();
    error ZeroAddress();
    error PolicyClientNotSet();
    error PolicyNotAvailable();
    error InvalidPolicyLength(uint256 idsLen, uint256 weightsLen);
    error InvalidPolicySum(uint256 sumBps);

    event FeeCharged(
        address indexed payer,
        address indexed receiver,
        uint256 grossAssets,
        uint256 feeAssets,
        uint256 feeAccumulatorAfter
    );

    event PolicyClientSet(address indexed policyClient);

    event PolicyApplied(uint256 indexed epoch, uint16[] weightsBps);

    event BucketsUpdated(uint256 indexed epoch, uint256[] amounts);

    event FeesClaimed(address indexed to, uint256 amount);

    constructor(
        IERC20 asset_,
        uint16 depositFeeBps_,
        address owner_,
        address policyClient_,
        uint256 policyEpochSeconds_,
        uint256 policyStartTimestamp_
    ) ERC4626(asset_, "Staked BEAM", "stBEAM") Ownable(owner_) {
        if (depositFeeBps_ >= BPS_DENOMINATOR) {
            revert InvalidDepositFeeBps();
        }
        if (policyEpochSeconds_ == 0) {
            revert InvalidEpochConfig();
        }

        DEPOSIT_FEE_BPS = depositFeeBps_;
        POLICY_EPOCH_SECONDS = policyEpochSeconds_;
        POLICY_START_TIMESTAMP =
            policyStartTimestamp_ == 0 ? block.timestamp : policyStartTimestamp_;

        if (policyClient_ != address(0)) {
            policyClient = policyClient_;
            emit PolicyClientSet(policyClient_);
        }
    }

    function setPolicyClient(address policyClient_) external onlyOwner {
        if (policyClient_ == address(0)) {
            revert ZeroAddress();
        }
        policyClient = policyClient_;
        emit PolicyClientSet(policyClient_);
    }

    function totalAssets() public view override returns (uint256) {
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        if (balance <= feeAccumulator) {
            return 0;
        }
        return balance - feeAccumulator;
    }

    function currentEpoch(uint256 timestamp) public view returns (uint256) {
        if (timestamp < POLICY_START_TIMESTAMP) {
            return 0;
        }
        return ((timestamp - POLICY_START_TIMESTAMP) / POLICY_EPOCH_SECONDS) + 1;
    }

    function getApplicablePolicyEpoch() public view returns (uint256) {
        uint256 epoch = currentEpoch(block.timestamp);
        if (epoch == 0) {
            return 0;
        }
        return epoch - 1;
    }

    function getActivePolicy()
        external
        view
        returns (uint256 epoch, uint256[] memory validatorIds, uint16[] memory weightsBps)
    {
        return (currentPolicyEpoch, _currentPolicyValidatorIds, _currentPolicyWeightsBps);
    }

    function getBuckets()
        external
        view
        returns (uint256[] memory validatorIds, uint256[] memory amounts)
    {
        uint256 len = _bucketValidatorIds.length;
        validatorIds = new uint256[](len);
        amounts = new uint256[](len);

        for (uint256 i = 0; i < len; i += 1) {
            uint256 validatorId = _bucketValidatorIds[i];
            validatorIds[i] = validatorId;
            amounts[i] = bucket[validatorId];
        }
    }

    // Fee is charged on the deposited amount (gross), not additional on top.
    function previewDeposit(uint256 assets) public view override returns (uint256) {
        uint256 netAssets = assets - _depositFee(assets);
        return _convertToShares(netAssets, false);
    }

    function previewMint(uint256 shares) public view override returns (uint256) {
        uint256 netAssets = _convertToAssets(shares, true);
        return _grossAssetsFromNet(netAssets);
    }

    function deposit(
        uint256 assets,
        address receiver
    ) public override returns (uint256 shares) {
        uint256 fee = _depositFee(assets);
        uint256 netAssets = assets - fee;

        shares = _convertToShares(netAssets, false);
        if (shares == 0) {
            revert InvalidAmount();
        }

        IERC20(asset()).safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);

        if (fee > 0) {
            feeAccumulator += fee;
            emit FeeCharged(msg.sender, receiver, assets, fee, feeAccumulator);
        }

        _applyAndDistribute(netAssets);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(
        uint256 shares,
        address receiver
    ) public override returns (uint256 assets) {
        uint256 netAssets = _convertToAssets(shares, true);
        assets = _grossAssetsFromNet(netAssets);

        uint256 fee = assets - netAssets;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);

        if (fee > 0) {
            feeAccumulator += fee;
            emit FeeCharged(msg.sender, receiver, assets, fee, feeAccumulator);
        }

        _applyAndDistribute(netAssets);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function applyPolicyForEpoch(
        uint256 epochToUse
    ) public returns (uint256 policyEpoch, bool usedFallback) {
        if (policyClient == address(0)) {
            revert PolicyClientNotSet();
        }

        uint256[] memory validatorIds;
        uint16[] memory weightsBps;
        (
            policyEpoch,
            validatorIds,
            weightsBps,
            usedFallback
        ) = IPolicyClientReader(policyClient).getPolicyOrFallback(epochToUse);

        _setActivePolicy(epochToUse, policyEpoch, validatorIds, weightsBps);
    }

    function applyPolicyForCurrentEpoch()
        external
        returns (uint256 policyEpoch, bool usedFallback)
    {
        uint256 epochToUse = getApplicablePolicyEpoch();
        return applyPolicyForEpoch(epochToUse);
    }

    function claimFees(address to, uint256 amount) external onlyOwner {
        if (amount > feeAccumulator) {
            revert InsufficientFeeBalance();
        }

        feeAccumulator -= amount;
        IERC20(asset()).safeTransfer(to, amount);

        emit FeesClaimed(to, amount);
    }

    function _applyAndDistribute(uint256 netAssets) internal {
        if (netAssets == 0) {
            revert InvalidAmount();
        }

        uint256 epochToUse = getApplicablePolicyEpoch();
        if (lastPolicyRequestEpoch != epochToUse) {
            applyPolicyForEpoch(epochToUse);
        }

        uint256 validatorsLen = _currentPolicyValidatorIds.length;
        if (validatorsLen == 0) {
            revert PolicyNotAvailable();
        }

        uint256[] memory parts = new uint256[](validatorsLen);
        uint256 sum;
        uint256 maxWeight;
        uint256 maxIdx;

        for (uint256 i = 0; i < validatorsLen; i += 1) {
            uint256 part = (netAssets * _currentPolicyWeightsBps[i]) / BPS_DENOMINATOR;
            parts[i] = part;
            sum += part;

            if (_currentPolicyWeightsBps[i] > maxWeight) {
                maxWeight = _currentPolicyWeightsBps[i];
                maxIdx = i;
            }
        }

        if (sum < netAssets) {
            parts[maxIdx] += (netAssets - sum);
        }

        for (uint256 i = 0; i < validatorsLen; i += 1) {
            uint256 validatorId = _currentPolicyValidatorIds[i];
            if (!_knownBucket[validatorId]) {
                _knownBucket[validatorId] = true;
                _bucketValidatorIds.push(validatorId);
            }

            bucket[validatorId] += parts[i];
        }

        emit BucketsUpdated(currentPolicyEpoch, parts);
    }

    function _setActivePolicy(
        uint256 requestedEpoch,
        uint256 policyEpoch,
        uint256[] memory validatorIds,
        uint16[] memory weightsBps
    ) internal {
        uint256 validatorsLen = validatorIds.length;
        if (validatorsLen == 0 || validatorsLen != weightsBps.length) {
            revert InvalidPolicyLength(validatorsLen, weightsBps.length);
        }

        uint256 sumBps;
        for (uint256 i = 0; i < validatorsLen; i += 1) {
            sumBps += weightsBps[i];
        }
        if (sumBps != BPS_DENOMINATOR) {
            revert InvalidPolicySum(sumBps);
        }

        delete _currentPolicyValidatorIds;
        delete _currentPolicyWeightsBps;

        for (uint256 i = 0; i < validatorsLen; i += 1) {
            _currentPolicyValidatorIds.push(validatorIds[i]);
            _currentPolicyWeightsBps.push(weightsBps[i]);
        }

        lastPolicyRequestEpoch = requestedEpoch;
        currentPolicyEpoch = policyEpoch;

        emit PolicyApplied(policyEpoch, weightsBps);
    }

    function _depositFee(uint256 assets) internal view returns (uint256) {
        return (assets * DEPOSIT_FEE_BPS) / BPS_DENOMINATOR;
    }

    function _grossAssetsFromNet(uint256 netAssets) internal view returns (uint256) {
        if (DEPOSIT_FEE_BPS == 0) {
            return netAssets;
        }

        uint256 denominator = BPS_DENOMINATOR - DEPOSIT_FEE_BPS;
        uint256 gross = (netAssets * BPS_DENOMINATOR) / denominator;

        if ((gross * denominator) / BPS_DENOMINATOR < netAssets) {
            gross += 1;
        }

        return gross;
    }
}
