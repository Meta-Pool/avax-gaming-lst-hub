// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../IERC20.sol";

library SafeERC20 {
    error SafeERC20FailedOperation(address token);

    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        bool ok = token.transfer(to, value);
        if (!ok) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    function safeTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 value
    ) internal {
        bool ok = token.transferFrom(from, to, value);
        if (!ok) {
            revert SafeERC20FailedOperation(address(token));
        }
    }
}
