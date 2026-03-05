// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Burnable} from "./vendor/openzeppelin/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20} from "./vendor/openzeppelin/token/ERC20/ERC20.sol";
import {Ownable} from "./vendor/openzeppelin/access/Ownable.sol";

/// @title Meta Pool Governance mpDAO Token.

contract MpDaoToken is ERC20Burnable, Ownable {
    /// @notice Maximum supply cap of 500 million tokens (with 6 decimals)
    uint256 public constant MAX_SUPPLY = 500_000_000 * 10 ** 6;

    /// @notice Error thrown when minting would exceed the maximum supply
    error ExceedsMaxSupply();
    error NotMinter(address account);

    mapping(address => bool) public isMinter;

    event MinterSet(address indexed minter, bool enabled);

    constructor(
        string memory name_,
        string memory symbol_,
        address _owner,
        uint256 _initialSupply
    ) ERC20(name_, symbol_) Ownable(_owner) {
        if (_initialSupply > MAX_SUPPLY) {
            revert ExceedsMaxSupply();
        }
        isMinter[_owner] = true;
        _mint(_owner, _initialSupply);
    }

    function setMinter(address minter, bool enabled) external onlyOwner {
        isMinter[minter] = enabled;
        emit MinterSet(minter, enabled);
    }

    function mint(address _receiver, uint256 _amount) external {
        if (!isMinter[msg.sender] && msg.sender != owner()) {
            revert NotMinter(msg.sender);
        }
        if (totalSupply() + _amount > MAX_SUPPLY) {
            revert ExceedsMaxSupply();
        }
        _mint(_receiver, _amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
