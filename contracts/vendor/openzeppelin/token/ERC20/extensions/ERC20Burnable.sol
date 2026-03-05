// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "../ERC20.sol";

abstract contract ERC20Burnable is ERC20 {
    function burn(uint256 value) public virtual {
        _burn(msg.sender, value);
    }

    function burnFrom(address account, uint256 value) public virtual {
        uint256 currentAllowance = allowance(account, msg.sender);
        require(currentAllowance >= value, "ERC20: insufficient allowance");
        _approve(account, msg.sender, currentAllowance - value);
        _burn(account, value);
    }
}
