// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IQorePQC} from "./interfaces/IQorePQC.sol";

/// @notice Read-only Phase 0 probe; holds no assets and has no administrative powers.
contract DiscoveryProbe {
    error InvalidKeyLength();
    error InvalidSignatureLength();

    IQorePQC internal constant PQC = IQorePQC(0x0000000000000000000000000000000000000a01);

    /// @notice Read the EVM-visible native balance of any address (assumption A1).
    function nativeBalance(address account) external view returns (uint256) {
        return account.balance;
    }

    /// @notice Call the real chain verifier; empty return data fails ABI decoding.
    function verify(bytes calldata pk, bytes calldata sig, bytes calldata message) external view returns (bool) {
        if (pk.length != 2592) revert InvalidKeyLength();
        if (sig.length != 4627) revert InvalidSignatureLength();
        return PQC.pqcVerify(pk, sig, message);
    }
}
