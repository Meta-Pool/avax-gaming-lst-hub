// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "./vendor/openzeppelin/token/ERC20/IERC20.sol";
import {ERC4626} from "./vendor/openzeppelin/token/ERC20/extensions/ERC4626.sol";
import {Ownable} from "./vendor/openzeppelin/access/Ownable.sol";
import {SafeERC20} from "./vendor/openzeppelin/token/ERC20/utils/SafeERC20.sol";

contract StBEAMVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public immutable DEPOSIT_FEE_BPS;

    // Accumulated fees denominated in the underlying asset (not in shares).
    uint256 public feeAccumulator;

    error InvalidDepositFeeBps();
    error InvalidAmount();
    error InsufficientFeeBalance();

    event FeeCharged(
        address indexed payer,
        address indexed receiver,
        uint256 grossAssets,
        uint256 feeAssets,
        uint256 feeAccumulatorAfter
    );

    event FeesClaimed(address indexed to, uint256 amount);

    constructor(
        IERC20 asset_,
        uint16 depositFeeBps_,
        address owner_
    ) ERC4626(asset_, "Staked BEAM", "stBEAM") Ownable(owner_) {
        if (depositFeeBps_ >= BPS_DENOMINATOR) {
            revert InvalidDepositFeeBps();
        }

        DEPOSIT_FEE_BPS = depositFeeBps_;
    }

    function totalAssets() public view override returns (uint256) {
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        if (balance <= feeAccumulator) {
            return 0;
        }
        return balance - feeAccumulator;
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

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function claimFees(address to, uint256 amount) external onlyOwner {
        if (amount > feeAccumulator) {
            revert InsufficientFeeBalance();
        }

        feeAccumulator -= amount;
        IERC20(asset()).safeTransfer(to, amount);

        emit FeesClaimed(to, amount);
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
