// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "./vendor/openzeppelin/token/ERC20/ERC20.sol";
import {Ownable} from "./vendor/openzeppelin/access/Ownable.sol";

contract BeamAssetMock is ERC20, Ownable {
    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        if (initialSupply_ > 0) {
            _mint(owner_, initialSupply_);
        }
    }

    function mint(address receiver, uint256 amount) external onlyOwner {
        _mint(receiver, amount);
    }
}
