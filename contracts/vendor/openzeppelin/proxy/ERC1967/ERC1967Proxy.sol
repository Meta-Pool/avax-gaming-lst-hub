// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ERC1967Proxy {
    bytes32 private constant _IMPLEMENTATION_SLOT =
        0x360894A13BA1A3210667C828492DB98DCA3E2076CC3735A920A3CA505D382BBC;

    constructor(address implementation_, bytes memory data_) payable {
        require(implementation_ != address(0), "Proxy: impl is zero");
        require(implementation_.code.length > 0, "Proxy: impl has no code");

        bytes32 slot = _IMPLEMENTATION_SLOT;
        assembly {
            sstore(slot, implementation_)
        }

        if (data_.length > 0) {
            (bool ok, bytes memory reason) = implementation_.delegatecall(data_);
            if (!ok) {
                assembly {
                    revert(add(reason, 0x20), mload(reason))
                }
            }
        }
    }

    function implementation() external view returns (address impl) {
        bytes32 slot = _IMPLEMENTATION_SLOT;
        assembly {
            impl := sload(slot)
        }
    }

    fallback() external payable {
        _delegate();
    }

    receive() external payable {
        _delegate();
    }

    function _delegate() private {
        address impl;
        bytes32 slot = _IMPLEMENTATION_SLOT;
        assembly {
            impl := sload(slot)
        }

        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}
