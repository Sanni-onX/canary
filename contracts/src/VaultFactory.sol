// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {PQVault} from "./PQVault.sol";
import {PQAuth} from "./PQAuth.sol";
import {CanaryRegistry} from "./CanaryRegistry.sol";

/// @notice Immutable EIP-1167 factory. No proxy admin, upgrade authority or asset sweep exists.
contract VaultFactory {
    error InvalidOwner();
    address public immutable implementation;
    uint64 public immutable MIN_TIMELOCK;
    uint64 public immutable MIN_COOLING_OFF;
    mapping(address => uint256) public creationNonce;
    mapping(address => address[]) private vaults;
    event VaultCreated(address indexed owner, address indexed vault, bytes32 pqKeyHash, address rescue);

    constructor(CanaryRegistry registry, uint64 minimumDelay, uint64 minimumCooling) {
        MIN_TIMELOCK = minimumDelay;
        MIN_COOLING_OFF = minimumCooling;
        implementation = address(new PQVault(registry, minimumDelay, minimumCooling));
    }

    /// @notice Enumerate a user's vaults created by this immutable factory.
    function vaultsOf(address owner) external view returns (address[] memory) {
        return vaults[owner];
    }

    /// @notice Ownership binding additionally binds the initial policy and one-time creation nonce.
    function bindingDigest(address owner, bytes32 keyHash, address rescue, PQVault.Policy calldata policy)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                "CANARY_BIND_V1", block.chainid, address(this), owner, keyHash, rescue, policy, creationNonce[owner]
            )
        );
    }

    /// @notice Create and initialize a vault only when both the owner transaction and PQ proof consent.
    function createVault(
        address owner,
        bytes32 keyHash,
        address rescue,
        PQVault.Policy calldata policy,
        bytes calldata pk,
        bytes calldata bindingProof
    ) external returns (address vault) {
        if (owner != msg.sender || owner == address(0)) revert InvalidOwner();
        PQAuth.check(keyHash, bindingDigest(owner, keyHash, rescue, policy), pk, bindingProof);
        uint256 nonce = creationNonce[owner]++;
        vault = Clones.cloneDeterministic(implementation, keccak256(abi.encode(owner, nonce)));
        PQVault(payable(vault)).initialize(owner, keyHash, rescue, policy);
        vaults[owner].push(vault);
        emit VaultCreated(owner, vault, keyHash, rescue);
    }
}
