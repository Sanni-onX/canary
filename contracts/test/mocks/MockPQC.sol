// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Test-only plumbing stub. Not cryptography; never deploy this contract.
contract MockPQC {
    function pqcVerify(bytes calldata, bytes calldata, bytes calldata) external pure returns (bool) {
        return true;
    }
}
