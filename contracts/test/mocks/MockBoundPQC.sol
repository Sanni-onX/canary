// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice NOT CRYPTOGRAPHY. Deterministic digest-binding stub for local state-machine tests only.
contract MockBoundPQC {
    function pqcVerify(bytes calldata pk, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool)
    {
        return pk.length == 2592 && signature.length == 4627
            && bytes32(signature[:32]) == keccak256(abi.encode(pk, message));
    }
}
