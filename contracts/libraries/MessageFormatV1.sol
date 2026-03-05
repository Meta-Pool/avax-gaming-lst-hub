// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library MessageFormatV1 {
    uint8 internal constant REQUEST_POLICY = 1;
    uint8 internal constant POLICY_RESPONSE = 2;

    error InvalidMessageType(uint8 found, uint8 expected);
    error InvalidPayload();

    struct RequestPolicy {
        uint256 epoch;
        address requester;
        address vaultAddress;
    }

    struct PolicyResponse {
        uint256 epoch;
        uint256[] validatorIds;
        uint16[] weightsBps;
    }

    function encodeRequestPolicy(
        RequestPolicy memory req
    ) internal pure returns (bytes memory) {
        return abi.encode(REQUEST_POLICY, req.epoch, req.requester, req.vaultAddress);
    }

    function encodePolicyResponse(
        PolicyResponse memory res
    ) internal pure returns (bytes memory) {
        return abi.encode(POLICY_RESPONSE, res.epoch, res.validatorIds, res.weightsBps);
    }

    function decodeMessageType(bytes calldata payload) internal pure returns (uint8 messageType) {
        if (payload.length < 32) {
            revert InvalidPayload();
        }
        messageType = abi.decode(payload, (uint8));
    }

    function decodeRequestPolicy(
        bytes calldata payload
    ) internal pure returns (RequestPolicy memory req) {
        (uint8 t, uint256 epoch, address requester, address vaultAddress) = abi.decode(
            payload,
            (uint8, uint256, address, address)
        );
        if (t != REQUEST_POLICY) {
            revert InvalidMessageType(t, REQUEST_POLICY);
        }
        req = RequestPolicy({
            epoch: epoch,
            requester: requester,
            vaultAddress: vaultAddress
        });
    }

    function decodePolicyResponse(
        bytes calldata payload
    ) internal pure returns (PolicyResponse memory res) {
        (uint8 t, uint256 epoch, uint256[] memory validatorIds, uint16[] memory weightsBps) = abi
            .decode(payload, (uint8, uint256, uint256[], uint16[]));
        if (t != POLICY_RESPONSE) {
            revert InvalidMessageType(t, POLICY_RESPONSE);
        }
        res = PolicyResponse({
            epoch: epoch,
            validatorIds: validatorIds,
            weightsBps: weightsBps
        });
    }
}
