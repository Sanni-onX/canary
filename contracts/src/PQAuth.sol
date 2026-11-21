// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IQorePQC} from "./interfaces/IQorePQC.sol";

/// @notice Real chain verification only. Local test substitutions live under test/mocks.
library PQAuth {
    error InvalidPQProof();
    address internal constant VERIFIER = 0x0000000000000000000000000000000000000a01;

    /// @notice Fail closed on unavailable verifier, wrong sizes, wrong key or invalid signature.
    function check(bytes32 expected, bytes32 digest, bytes calldata pk, bytes calldata sig) internal view {
        if (pk.length != 2592 || sig.length != 4627 || keccak256(pk) != expected) revert InvalidPQProof();
        if (!IQorePQC(VERIFIER).pqcVerify(pk, sig, abi.encodePacked(digest))) revert InvalidPQProof();
    }
}
