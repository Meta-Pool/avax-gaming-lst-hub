// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Voting Power for the Meta Pool mpDAO token.

import {EnumerableSet} from "./vendor/openzeppelin/utils/structs/EnumerableSet.sol";
import {IERC20} from "./vendor/openzeppelin/token/ERC20/IERC20.sol";
import {IVotingPower} from "./interfaces/IVotingPower.sol";
import {Initializable} from "./vendor/openzeppelin/proxy/utils/Initializable.sol";
import {SafeERC20} from "./vendor/openzeppelin/token/ERC20/utils/SafeERC20.sol";

struct UnlockingPosition {
    uint256 releaseDate;
    uint256 amount;
}

struct LockedPosition {
    uint256 lockedDays;
    uint256 amount;
}

struct User {
    address user;
    uint256 mpDaoBalance;
    uint256 votingPower;
    LockedPosition[] lps;
    UnlockingPosition[] ulps;
}

library UnlockingLib {
    /// @notice Method to return the amount of seconds to release the amount in the `unlocking` position.
    /// If amount `0` is returned, then the amount is ready to be withdraw.
    function getSecs2Release(
        UnlockingPosition memory self
    ) internal view returns (uint256 _secs) {
        if (isUnlocking(self)) _secs = self.releaseDate - block.timestamp;
    }

    function isUnlocking(
        UnlockingPosition memory self
    ) internal view returns (bool) {
        return block.timestamp < self.releaseDate;
    }
}

contract VotingPowerV1 is Initializable, IVotingPower {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;
    using SafeERC20 for IERC20;
    using UnlockingLib for UnlockingPosition;

    uint256 public totalVotingPower;
    uint256 public totalMpDAO;

    // Inclusive range [30, 300]
    uint256 private constant MIN_LOCKING_DAYS = 30;
    uint256 private constant MAX_LOCKING_DAYS = 300;
    uint256 private constant MAX_LOCKED_POSITIONS = 10;

    EnumerableSet.AddressSet private users;
    // lockedPositionDays: we use UintSet to keep it unique, there can be only one 30 day-unbond locking position
    mapping(address => EnumerableSet.UintSet) private lockedPositionDays;
    // lockedPositionMpDAO: address => days => amount
    mapping(address => mapping(uint256 => uint256)) private lockedPositionMpDAO;
    mapping(address => uint256) private votingPower;
    // UnlockingPosition: address => postion, it is an array because you can have more than one with the same release date and/or amount
    mapping(address => UnlockingPosition[]) private unlockingPositions;

    // mpDAO address is set one-time only at initialize [immutable].
    IERC20 public mpDAO;

    modifier checkDays(uint256 _days) {
        if (_days < MIN_LOCKING_DAYS || _days > MAX_LOCKING_DAYS) {
            revert OutOfValidLockingPeriod(_days);
        }
        _;
    }

    function initialize(IERC20 _mpDAO) public initializer {
        mpDAO = _mpDAO;
    }

    // ******************
    // * View functions *
    // ******************

    /// @dev Get a list of all the account locked positions.
    function getLockedPositions(
        address _account
    ) public view returns (LockedPosition[] memory _results) {
        uint256[] memory lockedDays = lockedPositionDays[_account].values();
        uint256 len = lockedDays.length;
        _results = new LockedPosition[](len);
        if (len == 0) return _results;
        for (uint i; i < len; ++i) {
            _results[i] = LockedPosition(
                lockedDays[i], // Locked days
                lockedPositionMpDAO[_account][lockedDays[i]] // mpDAO token amount
            );
        }
    }

    function getUnlockingPositions(
        address _account
    ) external view returns (UnlockingPosition[] memory) {
        return unlockingPositions[_account];
    }

    /// @dev Method for the Meta Pool bot 🤖
    function getUsers(
        uint256 _from,
        uint256 _limit
    ) external view returns (User[] memory) {
        uint256 len = users.length();
        if (len == 0) return new User[](0);
        if (_from >= len) revert IndexOutOfBounds();
        uint256 upperLimit = _min(len, _from + _limit);
        // Adjust the size of _results to match the slice being returned
        User[] memory _results = new User[](upperLimit - _from);
        address user;
        for (uint i = _from; i < upperLimit; ++i) {
            user = users.at(i);
            // Adjust the index for _results
            _results[i - _from] = User(
                user,
                getLockedAmount(user),
                votingPower[user],
                getLockedPositions(user),
                unlockingPositions[user]
            );
        }
        return _results;
    }

    function getUser(address _account) external view returns (User memory) {
        return
            User(
                _account,
                getLockedAmount(_account),
                votingPower[_account],
                getLockedPositions(_account),
                unlockingPositions[_account]
            );
    }

    function getVotingPower(address _account) external view returns (uint256) {
        return votingPower[_account];
    }

    /// @dev The maximum value of `len`, and iterations, is given by MAX_LOCKED_POSITIONS.
    function getLockedAmount(
        address _account
    ) public view returns (uint256 _amount) {
        uint len = lockedPositionDays[_account].length();
        for (uint i; i < len; ++i) {
            _amount += lockedPositionMpDAO[_account][
                lockedPositionDays[_account].at(i)
            ];
        }
    }

    function getLockedAmountAt(
        address _account,
        uint256 _days
    ) external view returns (uint256) {
        return lockedPositionMpDAO[_account][_days];
    }

    function getUnlockAmount(
        address _account
    ) external view returns (uint256 _unlocking, uint256 _unlocked) {
        uint len = unlockingPositions[_account].length;
        UnlockingPosition memory _position;
        for (uint i; i < len; ++i) {
            _position = unlockingPositions[_account][i];
            if (_position.releaseDate > block.timestamp) {
                _unlocking += _position.amount;
            } else {
                _unlocked += _position.amount;
            }
        }
    }

    function previewVotingPower(
        uint256 _days,
        uint256 _amount
    ) external pure returns (uint256) {
        return _calculateVotingPower(_days, _amount);
    }

    // ******************
    // * mpDAO deposits *
    // ******************

    /// @notice Call this function to create, or fund, a Locked Position and get Voting Power.
    function createLockedPosition(
        uint256 _days,
        uint256 _amount
    ) external returns (uint256) {
        if (_amount == 0) revert InvalidZeroAmount();
        mpDAO.safeTransferFrom(msg.sender, address(this), _amount);
        totalMpDAO += _amount;
        users.add(msg.sender);

        emit Deposit(msg.sender, _days, _amount);
        return _createLockedPosition(msg.sender, _days, _amount);
    }

    // *******************
    // * Start Unlocking *
    // *******************

    function unlockPosition(uint256 _days) public {
        bool success = lockedPositionDays[msg.sender].remove(_days);
        if (!success) revert LockedPositionDaysNotFound(_days);

        uint256 amount = lockedPositionMpDAO[msg.sender][_days];
        lockedPositionMpDAO[msg.sender][_days] = 0;
        totalMpDAO -= amount;

        _decreaseVotingPower(msg.sender, _days, amount);
        _createUnlockingPosition(
            msg.sender,
            block.timestamp + _day2sec(_days),
            amount
        );
        emit Unlock(msg.sender, _days, amount);
    }

    function unlockPartialPosition(uint256 _days, uint256 _amount) external {
        bool success = lockedPositionDays[msg.sender].contains(_days);
        if (!success) revert LockedPositionDaysNotFound(_days);
        if (_amount == 0) revert InvalidZeroAmount();
        uint256 _availableAmount = lockedPositionMpDAO[msg.sender][_days];

        if (_availableAmount == _amount) {
            return unlockPosition(_days);
        }
        if (_amount > _availableAmount)
            revert NotEnoughAvailableAmount(_availableAmount, _amount);
        lockedPositionMpDAO[msg.sender][_days] -= _amount;

        uint256 _vp = _calculateVotingPower(_days, _amount);
        totalVotingPower -= _vp;
        votingPower[msg.sender] -= _vp;
        totalMpDAO -= _amount;

        _createUnlockingPosition(
            msg.sender,
            block.timestamp + _day2sec(_days),
            _amount
        );
        emit Unlock(msg.sender, _days, _amount);
    }

    // **********
    // * Extend *
    // **********

    function extendLockingPositionDays(
        uint256 _fromDays,
        uint256 _toDays
    ) external {
        if (_toDays < _fromDays) revert InvalidExtension(_fromDays, _toDays);
        bool success = lockedPositionDays[msg.sender].remove(_fromDays);
        if (!success) revert LockedPositionDaysNotFound(_fromDays);

        uint256 amount = lockedPositionMpDAO[msg.sender][_fromDays];
        lockedPositionMpDAO[msg.sender][_fromDays] = 0;

        _decreaseVotingPower(msg.sender, _fromDays, amount);
        _createLockedPosition(msg.sender, _toDays, amount);
        emit ExtendPositionDays(msg.sender, _fromDays, _toDays);
    }

    // **********
    // * Relock *
    // **********

    function relockPosition(uint256 _index, uint256 _days) public {
        UnlockingPosition memory _removedPosition = _removeNthPosition(
            msg.sender,
            _index
        );
        if (_day2sec(_days) < _removedPosition.getSecs2Release())
            revert InvalidLockedDays(_days);
        totalMpDAO += _removedPosition.amount;
        users.add(msg.sender);

        _createLockedPosition(msg.sender, _days, _removedPosition.amount);
        emit Relock(msg.sender, _days, _removedPosition.amount);
    }

    function relockPartialPosition(
        uint256 _index,
        uint256 _days,
        uint256 _amount
    ) external {
        UnlockingPosition memory _removedPosition = _removeNthPosition(
            msg.sender,
            _index
        );
        if (_day2sec(_days) < _removedPosition.getSecs2Release())
            revert InvalidLockedDays(_days);
        if (_removedPosition.amount == _amount)
            return relockPosition(_index, _days);
        if (_removedPosition.amount < _amount) revert InvalidLockedAmount();
        totalMpDAO += _amount;
        users.add(msg.sender);

        _createLockedPosition(msg.sender, _days, _amount);
        _createUnlockingPosition(
            msg.sender,
            _removedPosition.releaseDate,
            _removedPosition.amount - _amount
        );
        emit Relock(msg.sender, _days, _amount);
    }

    // ************
    // * Withdraw *
    // ************

    function withdraw(uint256 _index) external {
        uint256 len = unlockingPositions[msg.sender].length;
        if (len <= _index) revert IndexOutOfBounds();

        UnlockingPosition memory position = unlockingPositions[msg.sender][
            _index
        ];
        if (position.isUnlocking()) revert ImmatureUnlockingPosition();
        _removeNthPosition(msg.sender, _index);
        len -= 1;

        _withdraw(msg.sender, position.amount, len);
    }

    function withdrawAll() external returns (uint256 _toSend) {
        uint256 len = unlockingPositions[msg.sender].length;
        if (len == 0) revert EmptyUnlockingPositions();

        UnlockingPosition memory position;
        // Iterate over the indices in reverse order using a while loop
        uint i = len;
        while (i > 0) {
            i--; // Decrement i first to convert length to 0-based index
            position = unlockingPositions[msg.sender][i];
            if (!position.isUnlocking()) {
                _toSend += position.amount;
                _removeNthPosition(msg.sender, i);
                len -= 1;
            }
            // No need to decrement i here as it's already done at the beginning of the loop
        }

        if (_toSend == 0) revert InvalidZeroAmount();
        _withdraw(msg.sender, _toSend, len);
    }

    // ***********
    // * Private *
    // ***********

    /// @param _positionLen The amount of remaining locking positions for the user.
    function _withdraw(
        address _receiver,
        uint256 _amount,
        uint256 _positionLen
    ) private {
        // if this was the last locking position the user had
        // and the user has no voting power (no locks)
        // then remove the user
        if (_positionLen == 0 && votingPower[_receiver] == 0) {
            users.remove(_receiver);
        }

        mpDAO.safeTransfer(_receiver, _amount);
        emit Withdraw(_receiver, _amount);
    }

    /// @dev First add() the days to the lockedPosition set, and then check the lenght.
    function _createLockedPosition(
        address _receiver,
        uint256 _days,
        uint256 _amount
    ) private checkDays(_days) returns (uint256 _vp) {
        lockedPositionDays[_receiver].add(_days);
        if (lockedPositionDays[_receiver].length() > MAX_LOCKED_POSITIONS)
            revert ExceededLockedPositions();
        lockedPositionMpDAO[_receiver][_days] += _amount;
        _vp = _calculateVotingPower(_days, _amount);
        votingPower[_receiver] += _vp;
        totalVotingPower += _vp;
    }

    function _decreaseVotingPower(
        address _receiver,
        uint256 _days,
        uint256 _amount
    ) private {
        uint256 _vp = _calculateVotingPower(_days, _amount);
        totalVotingPower -= _vp;
        votingPower[_receiver] -= _vp;
    }

    function _removeNthPosition(
        address _receiver,
        uint256 _index
    ) private returns (UnlockingPosition memory _pos) {
        uint256 len = unlockingPositions[_receiver].length;
        if (_index >= len) revert IndexOutOfBounds();

        _pos = unlockingPositions[_receiver][_index];
        // If the array has only one element or we are removing the last element, just pop
        if (len == 1 || _index == len - 1) {
            unlockingPositions[_receiver].pop();
        } else {
            // Replace the nth element with the last element
            unlockingPositions[_receiver][_index] = unlockingPositions[
                _receiver
            ][len - 1];
            // Remove the last element
            unlockingPositions[_receiver].pop();
        }
    }

    function _createUnlockingPosition(
        address _receiver,
        uint256 _releaseDate,
        uint256 _amount
    ) private {
        unlockingPositions[_receiver].push(
            UnlockingPosition(_releaseDate, _amount)
        );
    }

    /// @notice Voting power is given by f(x) = Amount * unbondDays / 60
    /// multiplier is 0.5x for 30d, 1x for 60d, 3x for 120d... and 5x for 300d
    function _calculateVotingPower(
        uint256 _unbondDays,
        uint256 _amount
    ) private pure returns (uint256) {
        return (_amount * _unbondDays) / 60;
    }

    /// Convert days into seconds.
    function _day2sec(uint256 _days) private pure returns (uint256) {
        return _days * 1 days;
    }

    /// @dev get the min value of two integers.
    function _min(uint256 _a, uint256 _b) private pure returns (uint256) {
        if (_a > _b) {
            return _b;
        } else {
            return _a;
        }
    }
}
