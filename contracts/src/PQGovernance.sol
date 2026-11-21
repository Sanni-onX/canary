// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PQAuth} from "./PQAuth.sol";

/// @notice Bounded m-of-n real ML-DSA governance; anyone may execute an approved action after its delay.
contract PQGovernance {
    error InvalidProposal();
    error NotReady();
    error ExecutionFailed();
    bytes32[] public guardians;
    uint256 public threshold;
    uint256 public nonce;
    uint256 public immutable timelock;
    mapping(bytes32 => uint256) public readyAt;
    event ActionQueued(bytes32 indexed id, address indexed target, bytes data, uint256 readyAt);
    event ActionExecuted(bytes32 indexed id);
    event GuardiansRotated(bytes32[] hashes, uint256 threshold);

    constructor(bytes32[] memory hashes, uint256 m, uint256 delay) {
        if (delay == 0) revert InvalidProposal();
        timelock = delay;
        _setGuardians(hashes, m);
    }

    /// @notice Compute the action-specific, chain/contract/nonce/deadline-bound digest.
    function actionDigest(address target, bytes calldata data, uint256 proposalNonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                "CANARY_GOVERNANCE_V1", block.chainid, address(this), target, keccak256(data), proposalNonce, deadline
            )
        );
    }

    /// @notice Verify distinct guardians then queue the exact action behind a timelock.
    function queue(
        address target,
        bytes calldata data,
        uint256 deadline,
        uint256[] calldata indexes,
        bytes[] calldata pks,
        bytes[] calldata sigs
    ) external returns (bytes32 id) {
        if (
            target.code.length == 0 || block.timestamp > deadline || indexes.length < threshold
                || indexes.length > guardians.length || indexes.length != pks.length || pks.length != sigs.length
        ) revert InvalidProposal();
        id = actionDigest(target, data, nonce, deadline);
        for (uint256 i; i < indexes.length; ++i) {
            if (indexes[i] >= guardians.length || (i != 0 && indexes[i] <= indexes[i - 1])) revert InvalidProposal();
            PQAuth.check(guardians[indexes[i]], id, pks[i], sigs[i]);
        }
        ++nonce;
        readyAt[id] = block.timestamp + timelock;
        emit ActionQueued(id, target, data, readyAt[id]);
    }

    /// @notice Execute only the queued calldata once its delay has elapsed.
    function execute(address target, bytes calldata data, uint256 proposalNonce, uint256 deadline) external {
        bytes32 id = actionDigest(target, data, proposalNonce, deadline);
        uint256 ready = readyAt[id];
        if (ready == 0 || block.timestamp < ready) revert NotReady();
        delete readyAt[id];
        (bool ok,) = target.call(data);
        if (!ok) revert ExecutionFailed();
        emit ActionExecuted(id);
    }

    /// @notice Guardian rotation is allowed only through the same PQ quorum and delay.
    function rotateGuardians(bytes32[] calldata hashes, uint256 m) external {
        if (msg.sender != address(this)) revert InvalidProposal();
        _setGuardians(hashes, m);
    }

    function _setGuardians(bytes32[] memory hashes, uint256 m) private {
        if (hashes.length == 0 || hashes.length > 8 || m == 0 || m > hashes.length) revert InvalidProposal();
        for (uint256 i; i < hashes.length; ++i) {
            if (hashes[i] == bytes32(0)) revert InvalidProposal();
            for (uint256 j; j < i; ++j) {
                if (hashes[j] == hashes[i]) revert InvalidProposal();
            }
        }
        guardians = hashes;
        threshold = m;
        emit GuardiansRotated(hashes, m);
    }
}
