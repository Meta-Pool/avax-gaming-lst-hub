// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IVotingPower {
    error EmptyUnlockingPositions();
    error ExceededLockedPositions();
    error ImmatureUnlockingPosition();
    error IndexOutOfBounds();
    error InvalidExtension(uint256 _fromDays, uint256 _toDays);
    error InvalidLockedAmount();
    error InvalidLockedDays(uint256 _days);
    error InvalidZeroAmount();
    error LockedPositionDaysNotFound(uint256 _days);
    error NotEnoughAvailableAmount(uint256 _available, uint256 _requested);
    error OutOfValidLockingPeriod(uint256 _days);

    event Deposit(address indexed _account, uint256 _days, uint256 _amount);
    event ExtendPositionDays(
        address indexed _account,
        uint256 _fromDays,
        uint256 _toDays
    );
    event Relock(address indexed _account, uint256 _days, uint256 _amount);
    event Unlock(address indexed _account, uint256 _days, uint256 _amount);
    event Withdraw(address indexed _account, uint256 _amount);

    function createLockedPosition(
        uint256 _days,
        uint256 _amount
    ) external returns (uint256);

    function extendLockingPositionDays(
        uint256 _fromDays,
        uint256 _toDays
    ) external;

    function relockPosition(uint256 _index, uint256 _days) external;

    function unlockPartialPosition(uint256 _days, uint256 _amount) external;

    function unlockPosition(uint256 _days) external;

    function withdraw(uint256 _index) external;

    function withdrawAll() external returns (uint256 _toSend);
}
