// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice QoreChain's documented ML-DSA-87 verifier at testnet address 0x0a01.
interface IQorePQC {
    /// @notice Verify a signature over the original message bytes.
    /// @param pubkey The 2592-byte ML-DSA-87 public key.
    /// @param signature The 4627-byte ML-DSA-87 signature.
    /// @param message The message signed by the key holder.
    /// @return valid Whether the signature is valid.
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);
}
