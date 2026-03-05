// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "../ERC20.sol";
import {IERC20} from "../IERC20.sol";
import {SafeERC20} from "../utils/SafeERC20.sol";
import {IERC20Metadata} from "./IERC20Metadata.sol";
import {IERC4626} from "../../../interfaces/IERC4626.sol";

abstract contract ERC4626 is ERC20, IERC4626 {
    using SafeERC20 for IERC20;

    IERC20 private immutable _asset;
    uint8 private immutable _assetDecimals;

    error InvalidAssetAddress();
    error ZeroShares();
    error ZeroAssets();

    constructor(IERC20 asset_, string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        if (address(asset_) == address(0)) {
            revert InvalidAssetAddress();
        }
        _asset = asset_;
        _assetDecimals = _tryGetAssetDecimals(asset_);
    }

    function asset() public view virtual returns (address) {
        return address(_asset);
    }

    function decimals() public view virtual override returns (uint8) {
        return _assetDecimals;
    }

    function totalAssets() public view virtual returns (uint256) {
        return _asset.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view virtual returns (uint256) {
        return _convertToShares(assets, false);
    }

    function convertToAssets(uint256 shares) public view virtual returns (uint256) {
        return _convertToAssets(shares, false);
    }

    function maxDeposit(address) public view virtual returns (uint256) {
        return type(uint256).max;
    }

    function previewDeposit(uint256 assets) public view virtual returns (uint256) {
        return _convertToShares(assets, false);
    }

    function deposit(uint256 assets, address receiver) public virtual returns (uint256 shares) {
        shares = previewDeposit(assets);
        if (shares == 0) {
            revert ZeroShares();
        }

        _deposit(msg.sender, receiver, assets, shares);
    }

    function maxMint(address) public view virtual returns (uint256) {
        return type(uint256).max;
    }

    function previewMint(uint256 shares) public view virtual returns (uint256) {
        return _convertToAssets(shares, true);
    }

    function mint(uint256 shares, address receiver) public virtual returns (uint256 assets) {
        assets = previewMint(shares);
        if (assets == 0) {
            revert ZeroAssets();
        }

        _deposit(msg.sender, receiver, assets, shares);
    }

    function maxWithdraw(address owner) public view virtual returns (uint256) {
        return _convertToAssets(balanceOf(owner), false);
    }

    function previewWithdraw(uint256 assets) public view virtual returns (uint256) {
        return _convertToShares(assets, true);
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public virtual returns (uint256 shares) {
        shares = previewWithdraw(assets);
        _withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function maxRedeem(address owner) public view virtual returns (uint256) {
        return balanceOf(owner);
    }

    function previewRedeem(uint256 shares) public view virtual returns (uint256) {
        return _convertToAssets(shares, false);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public virtual returns (uint256 assets) {
        assets = previewRedeem(shares);
        _withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal virtual {
        _asset.safeTransferFrom(caller, address(this), assets);
        _mint(receiver, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual {
        if (caller != owner) {
            uint256 currentAllowance = allowance(owner, caller);
            require(currentAllowance >= shares, "ERC4626: insufficient allowance");
            _approve(owner, caller, currentAllowance - shares);
        }

        _burn(owner, shares);
        _asset.safeTransfer(receiver, assets);

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    function _convertToShares(
        uint256 assets,
        bool roundUp
    ) internal view virtual returns (uint256) {
        uint256 supply = totalSupply();
        uint256 managedAssets = totalAssets();

        if (supply == 0 || managedAssets == 0) {
            return assets;
        }

        uint256 numerator = assets * supply;
        uint256 shares = numerator / managedAssets;

        if (roundUp && shares * managedAssets < numerator) {
            shares += 1;
        }

        return shares;
    }

    function _convertToAssets(
        uint256 shares,
        bool roundUp
    ) internal view virtual returns (uint256) {
        uint256 supply = totalSupply();
        uint256 managedAssets = totalAssets();

        if (supply == 0 || managedAssets == 0) {
            return shares;
        }

        uint256 numerator = shares * managedAssets;
        uint256 assets = numerator / supply;

        if (roundUp && assets * supply < numerator) {
            assets += 1;
        }

        return assets;
    }

    function _tryGetAssetDecimals(IERC20 asset_) private view returns (uint8) {
        (bool success, bytes memory data) = address(asset_).staticcall(
            abi.encodeWithSelector(IERC20Metadata.decimals.selector)
        );

        if (success && data.length >= 32) {
            return abi.decode(data, (uint8));
        }

        return 18;
    }
}
