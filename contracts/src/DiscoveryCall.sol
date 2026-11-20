// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DiscoveryProbe} from "./DiscoveryProbe.sol";

/// @notice Execute with eth_call contract creation: exercises actual EVM instructions
/// and the chain verifier without broadcasting or retaining a contract on chain.
contract DiscoveryCall {
    /// @notice Return native balance, signature verdict, and verifier gas as ABI bytes.
    constructor(address account, bytes memory pk, bytes memory sig, bytes memory message) {
        DiscoveryProbe probe = new DiscoveryProbe();
        uint256 balance = probe.nativeBalance(account);
        uint256 beforeGas = gasleft();
        bool valid = probe.verify(pk, sig, message);
        uint256 verifyGas = beforeGas - gasleft();
        bytes memory result = abi.encode(balance, valid, verifyGas);
        assembly ("memory-safe") {
            return(add(result, 32), mload(result))
        }
    }
}
