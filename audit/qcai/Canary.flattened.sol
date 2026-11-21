// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Source: contracts/src/CanaryRegistry.sol
/// @notice Bounded native-balance sentinel registry. Governance must itself enforce PQ and a timelock.
contract CanaryRegistry {
    error Unauthorized();
    error InvalidConfiguration();
    error InvalidCanary();
    error CooldownActive();
    uint256 public constant MAX_CANARIES = 16;
    address public immutable governance;
    uint256 public immutable thresholdK;
    uint256 public immutable toleranceBps;
    uint256 public immutable minCooldown;
    bool public alarmed;
    uint256 public lastAlarmBlock;
    uint256 public alarmTimestamp;

    struct Canary {
        address addr;
        uint256 baseline;
        bytes32 exposureTx;
        uint64 addedAt;
        bool retired;
    }
    Canary[] public canaries;
    mapping(address => bool) public usedCanary;
    event CanaryAdded(uint256 indexed index, address indexed account, uint256 baseline, bytes32 exposureTx);
    event CanaryRetired(uint256 indexed index);
    event CanaryReplaced(
        uint256 indexed index, address indexed previous, address indexed account, uint256 baseline, bytes32 exposureTx
    );
    event AlarmTripped(uint256[] drainedIndexes, uint256 blockNumber);
    event AlarmReset(bytes32 indexed evidenceHash, uint256 retainedAlarmBlock);

    constructor(address governor, uint256 k, uint256 tolerance, uint256 cooldown) {
        if (governor == address(0) || k == 0 || k > MAX_CANARIES || tolerance >= 10000 || cooldown == 0) {
            revert InvalidConfiguration();
        }
        governance = governor;
        thresholdK = k;
        toleranceBps = tolerance;
        minCooldown = cooldown;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    /// @notice Number of registered slots, including retired canaries.
    function canaryCount() external view returns (uint256) {
        return canaries.length;
    }

    /// @notice Atomically read security state; incomplete registries must deny classical release.
    function securityState() external view returns (bool alarm, uint256 lastBlock, bool ready) {
        uint256 active;
        for (uint256 i; i < canaries.length; ++i) {
            if (!canaries[i].retired) ++active;
        }
        return (alarmed, lastAlarmBlock, active >= thresholdK);
    }

    /// @notice Add an already exposed, funded bait account after governance's timelock.
    function addCanary(address account, bytes32 exposureTx) external onlyGovernance {
        if (canaries.length >= MAX_CANARIES) revert InvalidCanary();
        _requireFresh(account, exposureTx);
        usedCanary[account] = true;
        canaries.push(Canary(account, account.balance, exposureTx, uint64(block.timestamp), false));
        emit CanaryAdded(canaries.length - 1, account, account.balance, exposureTx);
    }

    /// @notice Rotate one slot through timelocked governance without increasing the bounded scan size.
    /// @dev Old accounts can never be reused. Replacement never clears alarm/history.
    function replaceCanary(uint256 index, address account, bytes32 exposureTx) external onlyGovernance {
        if (index >= canaries.length) revert InvalidCanary();
        _requireFresh(account, exposureTx);
        _checkAndTrip(); // Observe the old epoch before replacing any drain evidence.
        address previous = canaries[index].addr;
        usedCanary[account] = true;
        canaries[index] = Canary(account, account.balance, exposureTx, uint64(block.timestamp), false);
        emit CanaryReplaced(index, previous, account, account.balance, exposureTx);
    }

    function _requireFresh(address account, bytes32 exposureTx) private view {
        if (account == address(0) || account.balance < 10000 || exposureTx == bytes32(0) || usedCanary[account]) {
            revert InvalidCanary();
        }
    }

    /// @notice Retire a canary; never leave fewer active canaries than the threshold.
    function retireCanary(uint256 index) external onlyGovernance {
        if (index >= canaries.length || canaries[index].retired) revert InvalidCanary();
        uint256 active;
        for (uint256 i; i < canaries.length; ++i) {
            if (!canaries[i].retired) ++active;
        }
        if (active <= thresholdK) revert InvalidConfiguration();
        _checkAndTrip(); // Retirement cannot erase a threshold breach before the watcher observes it.
        canaries[index].retired = true;
        emit CanaryRetired(index);
    }

    /// @notice Current balance-based drain observation; not proof of quantum attribution.
    function drainedIndexes() public view returns (uint256[] memory indexes) {
        uint256[] memory work = new uint256[](canaries.length);
        uint256 count;
        for (uint256 i; i < canaries.length; ++i) {
            Canary storage c = canaries[i];
            // Overflow-safe floor(baseline * (10000-tolerance) / 10000).
            uint256 factor = 10000 - toleranceBps;
            uint256 floorBalance = c.baseline / 10000 * factor + c.baseline % 10000 * factor / 10000;
            if (!c.retired && c.addr.balance < floorBalance) work[count++] = i;
        }
        indexes = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            indexes[i] = work[i];
        }
    }

    /// @notice Permissionless, idempotent threshold evaluation; alarm latches until governance resets.
    function checkAndTrip() external returns (bool) {
        return _checkAndTrip();
    }

    function _checkAndTrip() private returns (bool) {
        if (alarmed) return true;
        uint256[] memory indexes = drainedIndexes();
        if (indexes.length >= thresholdK) {
            alarmed = true;
            lastAlarmBlock = block.number;
            alarmTimestamp = block.timestamp;
            emit AlarmTripped(indexes, block.number);
        }
        return alarmed;
    }

    /// @notice Reset only with evidence after cooldown; old withdrawal invalidation is permanent.
    function resetAlarm(bytes32 evidenceHash) external onlyGovernance {
        if (!alarmed || evidenceHash == bytes32(0)) revert InvalidConfiguration();
        if (block.timestamp < alarmTimestamp + minCooldown) revert CooldownActive();
        alarmed = false;
        emit AlarmReset(evidenceHash, lastAlarmBlock);
    }
}

// Source: contracts/src/interfaces/IQorePQC.sol
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

// Source: contracts/src/PQAuth.sol
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

// Source: contracts/src/PQGovernance.sol
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

// Source: node_modules/@openzeppelin/contracts/utils/Errors.sol
// OpenZeppelin Contracts (last updated v5.1.0) (utils/Errors.sol)

/**
 * @dev Collection of common custom errors used in multiple contracts
 *
 * IMPORTANT: Backwards compatibility is not guaranteed in future versions of the library.
 * It is recommended to avoid relying on the error API for critical functionality.
 *
 * _Available since v5.1._
 */
library Errors {
    /**
     * @dev The ETH balance of the account is not enough to perform the operation.
     */
    error InsufficientBalance(uint256 balance, uint256 needed);

    /**
     * @dev A call to an address target failed. The target may have reverted.
     */
    error FailedCall();

    /**
     * @dev The deployment failed.
     */
    error FailedDeployment();

    /**
     * @dev A necessary precompile is missing.
     */
    error MissingPrecompile(address);
}

// Source: node_modules/@openzeppelin/contracts/utils/LowLevelCall.sol
// OpenZeppelin Contracts (last updated v5.6.0) (utils/LowLevelCall.sol)

/**
 * @dev Library of low level call functions that implement different calling strategies to deal with the return data.
 *
 * WARNING: Using this library requires an advanced understanding of Solidity and how the EVM works. It is recommended
 * to use the {Address} library instead.
 */
library LowLevelCall {
    /// @dev Performs a Solidity function call using a low level `call` and ignoring the return data.
    function callNoReturn(address target, bytes memory data) internal returns (bool success) {
        return callNoReturn(target, 0, data);
    }

    /// @dev Same as {callNoReturn-address-bytes}, but allows specifying the value to be sent in the call.
    function callNoReturn(address target, uint256 value, bytes memory data) internal returns (bool success) {
        assembly ("memory-safe") {
            success := call(gas(), target, value, add(data, 0x20), mload(data), 0x00, 0x00)
        }
    }

    /// @dev Performs a Solidity function call using a low level `call` and returns the first 64 bytes of the result
    /// in the scratch space of memory. Useful for functions that return a tuple with two single-word values.
    ///
    /// WARNING: Do not assume that the results are zero if `success` is false. Memory can be already allocated
    /// and this function doesn't zero it out.
    function callReturn64Bytes(
        address target,
        bytes memory data
    ) internal returns (bool success, bytes32 result1, bytes32 result2) {
        return callReturn64Bytes(target, 0, data);
    }

    /// @dev Same as {callReturn64Bytes-address-bytes}, but allows specifying the value to be sent in the call.
    function callReturn64Bytes(
        address target,
        uint256 value,
        bytes memory data
    ) internal returns (bool success, bytes32 result1, bytes32 result2) {
        assembly ("memory-safe") {
            success := call(gas(), target, value, add(data, 0x20), mload(data), 0x00, 0x40)
            result1 := mload(0x00)
            result2 := mload(0x20)
        }
    }

    /// @dev Performs a Solidity function call using a low level `staticcall` and ignoring the return data.
    function staticcallNoReturn(address target, bytes memory data) internal view returns (bool success) {
        assembly ("memory-safe") {
            success := staticcall(gas(), target, add(data, 0x20), mload(data), 0x00, 0x00)
        }
    }

    /// @dev Performs a Solidity function call using a low level `staticcall` and returns the first 64 bytes of the result
    /// in the scratch space of memory. Useful for functions that return a tuple with two single-word values.
    ///
    /// WARNING: Do not assume that the results are zero if `success` is false. Memory can be already allocated
    /// and this function doesn't zero it out.
    function staticcallReturn64Bytes(
        address target,
        bytes memory data
    ) internal view returns (bool success, bytes32 result1, bytes32 result2) {
        assembly ("memory-safe") {
            success := staticcall(gas(), target, add(data, 0x20), mload(data), 0x00, 0x40)
            result1 := mload(0x00)
            result2 := mload(0x20)
        }
    }

    /// @dev Performs a Solidity function call using a low level `delegatecall` and ignoring the return data.
    function delegatecallNoReturn(address target, bytes memory data) internal returns (bool success) {
        assembly ("memory-safe") {
            success := delegatecall(gas(), target, add(data, 0x20), mload(data), 0x00, 0x00)
        }
    }

    /// @dev Performs a Solidity function call using a low level `delegatecall` and returns the first 64 bytes of the result
    /// in the scratch space of memory. Useful for functions that return a tuple with two single-word values.
    ///
    /// WARNING: Do not assume that the results are zero if `success` is false. Memory can be already allocated
    /// and this function doesn't zero it out.
    function delegatecallReturn64Bytes(
        address target,
        bytes memory data
    ) internal returns (bool success, bytes32 result1, bytes32 result2) {
        assembly ("memory-safe") {
            success := delegatecall(gas(), target, add(data, 0x20), mload(data), 0x00, 0x40)
            result1 := mload(0x00)
            result2 := mload(0x20)
        }
    }

    /// @dev Returns the size of the return data buffer.
    function returnDataSize() internal pure returns (uint256 size) {
        assembly ("memory-safe") {
            size := returndatasize()
        }
    }

    /// @dev Returns a buffer containing the return data from the last call.
    function returnData() internal pure returns (bytes memory result) {
        assembly ("memory-safe") {
            result := mload(0x40)
            mstore(result, returndatasize())
            returndatacopy(add(result, 0x20), 0x00, returndatasize())
            mstore(0x40, add(result, add(0x20, returndatasize())))
        }
    }

    /// @dev Revert with the return data from the last call.
    function bubbleRevert() internal pure {
        assembly ("memory-safe") {
            let fmp := mload(0x40)
            returndatacopy(fmp, 0x00, returndatasize())
            revert(fmp, returndatasize())
        }
    }

    function bubbleRevert(bytes memory returndata) internal pure {
        assembly ("memory-safe") {
            revert(add(returndata, 0x20), mload(returndata))
        }
    }
}

// Source: node_modules/@openzeppelin/contracts/utils/Create2.sol
// OpenZeppelin Contracts (last updated v5.5.0) (utils/Create2.sol)

/**
 * @dev Helper to make usage of the `CREATE2` EVM opcode easier and safer.
 * `CREATE2` can be used to compute in advance the address where a smart
 * contract will be deployed, which allows for interesting new mechanisms known
 * as 'counterfactual interactions'.
 *
 * See the https://eips.ethereum.org/EIPS/eip-1014#motivation[EIP] for more
 * information.
 */
library Create2 {
    /**
     * @dev There's no code to deploy.
     */
    error Create2EmptyBytecode();

    /**
     * @dev Deploys a contract using `CREATE2`. The address where the contract
     * will be deployed can be known in advance via {computeAddress}.
     *
     * The bytecode for a contract can be obtained from Solidity with
     * `type(contractName).creationCode`.
     *
     * Requirements:
     *
     * - `bytecode` must not be empty.
     * - `salt` must have not been used for `bytecode` already.
     * - the factory must have a balance of at least `amount`.
     * - if `amount` is non-zero, `bytecode` must have a `payable` constructor.
     */
    function deploy(uint256 amount, bytes32 salt, bytes memory bytecode) internal returns (address addr) {
        if (address(this).balance < amount) {
            revert Errors.InsufficientBalance(address(this).balance, amount);
        }
        if (bytecode.length == 0) {
            revert Create2EmptyBytecode();
        }
        assembly ("memory-safe") {
            addr := create2(amount, add(bytecode, 0x20), mload(bytecode), salt)
        }
        if (addr == address(0)) {
            if (LowLevelCall.returnDataSize() == 0) {
                revert Errors.FailedDeployment();
            } else {
                LowLevelCall.bubbleRevert();
            }
        }
    }

    /**
     * @dev Returns the address where a contract will be stored if deployed via {deploy}. Any change in the
     * `bytecodeHash` or `salt` will result in a new destination address.
     */
    function computeAddress(bytes32 salt, bytes32 bytecodeHash) internal view returns (address) {
        return computeAddress(salt, bytecodeHash, address(this));
    }

    /**
     * @dev Returns the address where a contract will be stored if deployed via {deploy} from a contract located at
     * `deployer`. If `deployer` is this contract's address, returns the same value as {computeAddress}.
     */
    function computeAddress(bytes32 salt, bytes32 bytecodeHash, address deployer) internal pure returns (address addr) {
        assembly ("memory-safe") {
            let ptr := mload(0x40) // Get free memory pointer

            // |                     | ↓ ptr ...  ↓ ptr + 0x0B (start) ...  ↓ ptr + 0x20 ...  ↓ ptr + 0x40 ...   |
            // |---------------------|---------------------------------------------------------------------------|
            // | bytecodeHash        |                                                        CCCCCCCCCCCCC...CC |
            // | salt                |                                      BBBBBBBBBBBBB...BB                   |
            // | deployer            | 000000...0000AAAAAAAAAAAAAAAAAAA...AA                                     |
            // | 0xFF                |            FF                                                             |
            // |---------------------|---------------------------------------------------------------------------|
            // | memory              | 000000...00FFAAAAAAAAAAAAAAAAAAA...AABBBBBBBBBBBBB...BBCCCCCCCCCCCCC...CC |
            // | keccak(start, 0x55) |            ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑ |

            mstore(add(ptr, 0x40), bytecodeHash)
            mstore(add(ptr, 0x20), salt)
            mstore(ptr, deployer) // Right-aligned with 12 preceding garbage bytes
            let start := add(ptr, 0x0b) // The hashed data starts at the final garbage byte which we will set to 0xff
            mstore8(start, 0xff)
            addr := and(keccak256(start, 0x55), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }
}

// Source: node_modules/@openzeppelin/contracts/proxy/Clones.sol
// OpenZeppelin Contracts (last updated v5.5.0) (proxy/Clones.sol)

/**
 * @dev https://eips.ethereum.org/EIPS/eip-1167[ERC-1167] is a standard for
 * deploying minimal proxy contracts, also known as "clones".
 *
 * > To simply and cheaply clone contract functionality in an immutable way, this standard specifies
 * > a minimal bytecode implementation that delegates all calls to a known, fixed address.
 *
 * The library includes functions to deploy a proxy using either `create` (traditional deployment) or `create2`
 * (salted deterministic deployment). It also includes functions to predict the addresses of clones deployed using the
 * deterministic method.
 */
library Clones {
    error CloneArgumentsTooLong();

    /**
     * @dev Deploys and returns the address of a clone that mimics the behavior of `implementation`.
     *
     * This function uses the create opcode, which should never revert.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     */
    function clone(address implementation) internal returns (address instance) {
        return clone(implementation, 0);
    }

    /**
     * @dev Same as {xref-Clones-clone-address-}[clone], but with a `value` parameter to send native currency
     * to the new contract.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     *
     * NOTE: Using a non-zero value at creation will require the contract using this function (e.g. a factory)
     * to always have enough balance for new deployments. Consider exposing this function under a payable method.
     */
    function clone(address implementation, uint256 value) internal returns (address instance) {
        if (address(this).balance < value) {
            revert Errors.InsufficientBalance(address(this).balance, value);
        }
        assembly ("memory-safe") {
            // Cleans the upper 96 bits of the `implementation` word, then packs the first 3 bytes
            // of the `implementation` address with the bytecode before the address.
            mstore(0x00, or(shr(232, shl(96, implementation)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            // Packs the remaining 17 bytes of `implementation` with the bytecode after the address.
            mstore(0x20, or(shl(120, implementation), 0x5af43d82803e903d91602b57fd5bf3))
            instance := create(value, 0x09, 0x37)
        }
        if (instance == address(0)) {
            revert Errors.FailedDeployment();
        }
    }

    /**
     * @dev Deploys and returns the address of a clone that mimics the behavior of `implementation`.
     *
     * This function uses the create2 opcode and a `salt` to deterministically deploy
     * the clone. Using the same `implementation` and `salt` multiple times will revert, since
     * the clones cannot be deployed twice at the same address.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     */
    function cloneDeterministic(address implementation, bytes32 salt) internal returns (address instance) {
        return cloneDeterministic(implementation, salt, 0);
    }

    /**
     * @dev Same as {xref-Clones-cloneDeterministic-address-bytes32-}[cloneDeterministic], but with
     * a `value` parameter to send native currency to the new contract.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     *
     * NOTE: Using a non-zero value at creation will require the contract using this function (e.g. a factory)
     * to always have enough balance for new deployments. Consider exposing this function under a payable method.
     */
    function cloneDeterministic(
        address implementation,
        bytes32 salt,
        uint256 value
    ) internal returns (address instance) {
        if (address(this).balance < value) {
            revert Errors.InsufficientBalance(address(this).balance, value);
        }
        assembly ("memory-safe") {
            // Cleans the upper 96 bits of the `implementation` word, then packs the first 3 bytes
            // of the `implementation` address with the bytecode before the address.
            mstore(0x00, or(shr(232, shl(96, implementation)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            // Packs the remaining 17 bytes of `implementation` with the bytecode after the address.
            mstore(0x20, or(shl(120, implementation), 0x5af43d82803e903d91602b57fd5bf3))
            instance := create2(value, 0x09, 0x37, salt)
        }
        if (instance == address(0)) {
            revert Errors.FailedDeployment();
        }
    }

    /**
     * @dev Computes the address of a clone deployed using {Clones-cloneDeterministic}.
     */
    function predictDeterministicAddress(
        address implementation,
        bytes32 salt,
        address deployer
    ) internal pure returns (address predicted) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(add(ptr, 0x38), deployer)
            mstore(add(ptr, 0x24), 0x5af43d82803e903d91602b57fd5bf3ff)
            mstore(add(ptr, 0x14), implementation)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73)
            mstore(add(ptr, 0x58), salt)
            mstore(add(ptr, 0x78), keccak256(add(ptr, 0x0c), 0x37))
            predicted := and(keccak256(add(ptr, 0x43), 0x55), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }

    /**
     * @dev Computes the address of a clone deployed using {Clones-cloneDeterministic}.
     */
    function predictDeterministicAddress(
        address implementation,
        bytes32 salt
    ) internal view returns (address predicted) {
        return predictDeterministicAddress(implementation, salt, address(this));
    }

    /**
     * @dev Deploys and returns the address of a clone that mimics the behavior of `implementation` with custom
     * immutable arguments. These are provided through `args` and cannot be changed after deployment. To
     * access the arguments within the implementation, use {fetchCloneArgs}.
     *
     * This function uses the create opcode, which should never revert.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     */
    function cloneWithImmutableArgs(address implementation, bytes memory args) internal returns (address instance) {
        return cloneWithImmutableArgs(implementation, args, 0);
    }

    /**
     * @dev Same as {xref-Clones-cloneWithImmutableArgs-address-bytes-}[cloneWithImmutableArgs], but with a `value`
     * parameter to send native currency to the new contract.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     *
     * NOTE: Using a non-zero value at creation will require the contract using this function (e.g. a factory)
     * to always have enough balance for new deployments. Consider exposing this function under a payable method.
     */
    function cloneWithImmutableArgs(
        address implementation,
        bytes memory args,
        uint256 value
    ) internal returns (address instance) {
        if (address(this).balance < value) {
            revert Errors.InsufficientBalance(address(this).balance, value);
        }
        bytes memory bytecode = _cloneCodeWithImmutableArgs(implementation, args);
        assembly ("memory-safe") {
            instance := create(value, add(bytecode, 0x20), mload(bytecode))
        }
        if (instance == address(0)) {
            revert Errors.FailedDeployment();
        }
    }

    /**
     * @dev Deploys and returns the address of a clone that mimics the behavior of `implementation` with custom
     * immutable arguments. These are provided through `args` and cannot be changed after deployment. To
     * access the arguments within the implementation, use {fetchCloneArgs}.
     *
     * This function uses the create2 opcode and a `salt` to deterministically deploy the clone. Using the same
     * `implementation`, `args` and `salt` multiple times will revert, since the clones cannot be deployed twice
     * at the same address.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     */
    function cloneDeterministicWithImmutableArgs(
        address implementation,
        bytes memory args,
        bytes32 salt
    ) internal returns (address instance) {
        return cloneDeterministicWithImmutableArgs(implementation, args, salt, 0);
    }

    /**
     * @dev Same as {xref-Clones-cloneDeterministicWithImmutableArgs-address-bytes-bytes32-}[cloneDeterministicWithImmutableArgs],
     * but with a `value` parameter to send native currency to the new contract.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     *
     * NOTE: Using a non-zero value at creation will require the contract using this function (e.g. a factory)
     * to always have enough balance for new deployments. Consider exposing this function under a payable method.
     */
    function cloneDeterministicWithImmutableArgs(
        address implementation,
        bytes memory args,
        bytes32 salt,
        uint256 value
    ) internal returns (address instance) {
        bytes memory bytecode = _cloneCodeWithImmutableArgs(implementation, args);
        return Create2.deploy(value, salt, bytecode);
    }

    /**
     * @dev Computes the address of a clone deployed using {Clones-cloneDeterministicWithImmutableArgs}.
     */
    function predictDeterministicAddressWithImmutableArgs(
        address implementation,
        bytes memory args,
        bytes32 salt,
        address deployer
    ) internal pure returns (address predicted) {
        bytes memory bytecode = _cloneCodeWithImmutableArgs(implementation, args);
        return Create2.computeAddress(salt, keccak256(bytecode), deployer);
    }

    /**
     * @dev Computes the address of a clone deployed using {Clones-cloneDeterministicWithImmutableArgs}.
     */
    function predictDeterministicAddressWithImmutableArgs(
        address implementation,
        bytes memory args,
        bytes32 salt
    ) internal view returns (address predicted) {
        return predictDeterministicAddressWithImmutableArgs(implementation, args, salt, address(this));
    }

    /**
     * @dev Get the immutable args attached to a clone.
     *
     * - If `instance` is a clone that was deployed using `clone` or `cloneDeterministic`, this
     *   function will return an empty array.
     * - If `instance` is a clone that was deployed using `cloneWithImmutableArgs` or
     *   `cloneDeterministicWithImmutableArgs`, this function will return the args array used at
     *   creation.
     * - If `instance` is NOT a clone deployed using this library, the behavior is undefined. This
     *   function should only be used to check addresses that are known to be clones.
     */
    function fetchCloneArgs(address instance) internal view returns (bytes memory) {
        bytes memory result = new bytes(instance.code.length - 0x2d); // revert if length is too short
        assembly ("memory-safe") {
            extcodecopy(instance, add(result, 0x20), 0x2d, mload(result))
        }
        return result;
    }

    /**
     * @dev Helper that prepares the initcode of the proxy with immutable args.
     *
     * An assembly variant of this function requires copying the `args` array, which can be efficiently done using
     * `mcopy`. Unfortunately, that opcode is not available before cancun. A pure solidity implementation using
     * abi.encodePacked is more expensive but also more portable and easier to review.
     *
     * NOTE: https://eips.ethereum.org/EIPS/eip-170[EIP-170] limits the length of the contract code to 24576 bytes.
     * With the proxy code taking 45 bytes, that limits the length of the immutable args to 24531 bytes.
     */
    function _cloneCodeWithImmutableArgs(
        address implementation,
        bytes memory args
    ) private pure returns (bytes memory) {
        if (args.length > 0x5fd3) revert CloneArgumentsTooLong();
        return
            abi.encodePacked(
                hex"61",
                uint16(args.length + 0x2d),
                hex"3d81600a3d39f3363d3d373d3d3d363d73",
                implementation,
                hex"5af43d82803e903d91602b57fd5bf3",
                args
            );
    }
}

// Source: node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol
// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/IERC20.sol)

/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */
interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

// Source: node_modules/@openzeppelin/contracts/interfaces/IERC20.sol
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC20.sol)

// Source: node_modules/@openzeppelin/contracts/utils/introspection/IERC165.sol
// OpenZeppelin Contracts (last updated v5.4.0) (utils/introspection/IERC165.sol)

/**
 * @dev Interface of the ERC-165 standard, as defined in the
 * https://eips.ethereum.org/EIPS/eip-165[ERC].
 *
 * Implementers can declare support of contract interfaces, which can then be
 * queried by others ({ERC165Checker}).
 *
 * For an implementation, see {ERC165}.
 */
interface IERC165 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[ERC section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

// Source: node_modules/@openzeppelin/contracts/interfaces/IERC165.sol
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC165.sol)

// Source: node_modules/@openzeppelin/contracts/interfaces/IERC1363.sol
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC1363.sol)

/**
 * @title IERC1363
 * @dev Interface of the ERC-1363 standard as defined in the https://eips.ethereum.org/EIPS/eip-1363[ERC-1363].
 *
 * Defines an extension interface for ERC-20 tokens that supports executing code on a recipient contract
 * after `transfer` or `transferFrom`, or code on a spender contract after `approve`, in a single transaction.
 */
interface IERC1363 is IERC20, IERC165 {
    /*
     * Note: the ERC-165 identifier for this interface is 0xb0202a11.
     * 0xb0202a11 ===
     *   bytes4(keccak256('transferAndCall(address,uint256)')) ^
     *   bytes4(keccak256('transferAndCall(address,uint256,bytes)')) ^
     *   bytes4(keccak256('transferFromAndCall(address,address,uint256)')) ^
     *   bytes4(keccak256('transferFromAndCall(address,address,uint256,bytes)')) ^
     *   bytes4(keccak256('approveAndCall(address,uint256)')) ^
     *   bytes4(keccak256('approveAndCall(address,uint256,bytes)'))
     */

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferAndCall(address to, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @param data Additional data with no specified format, sent in call to `to`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the allowance mechanism
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param from The address which you want to send tokens from.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferFromAndCall(address from, address to, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the allowance mechanism
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param from The address which you want to send tokens from.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @param data Additional data with no specified format, sent in call to `to`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferFromAndCall(address from, address to, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens and then calls {IERC1363Spender-onApprovalReceived} on `spender`.
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function approveAndCall(address spender, uint256 value) external returns (bool);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens and then calls {IERC1363Spender-onApprovalReceived} on `spender`.
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     * @param data Additional data with no specified format, sent in call to `spender`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function approveAndCall(address spender, uint256 value, bytes calldata data) external returns (bool);
}

// Source: node_modules/@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol
// OpenZeppelin Contracts (last updated v5.5.0) (token/ERC20/utils/SafeERC20.sol)

/**
 * @title SafeERC20
 * @dev Wrappers around ERC-20 operations that throw on failure (when the token
 * contract returns false). Tokens that return no value (and instead revert or
 * throw on failure) are also supported, non-reverting calls are assumed to be
 * successful.
 * To use this library you can add a `using SafeERC20 for IERC20;` statement to your contract,
 * which allows you to call the safe operations as `token.safeTransfer(...)`, etc.
 */
library SafeERC20 {
    /**
     * @dev An operation with an ERC-20 token failed.
     */
    error SafeERC20FailedOperation(address token);

    /**
     * @dev Indicates a failed `decreaseAllowance` request.
     */
    error SafeERC20FailedDecreaseAllowance(address spender, uint256 currentAllowance, uint256 requestedDecrease);

    /**
     * @dev Transfer `value` amount of `token` from the calling contract to `to`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     */
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        if (!_safeTransfer(token, to, value, true)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Transfer `value` amount of `token` from `from` to `to`, spending the approval given by `from` to the
     * calling contract. If `token` returns no value, non-reverting calls are assumed to be successful.
     */
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        if (!_safeTransferFrom(token, from, to, value, true)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Variant of {safeTransfer} that returns a bool instead of reverting if the operation is not successful.
     */
    function trySafeTransfer(IERC20 token, address to, uint256 value) internal returns (bool) {
        return _safeTransfer(token, to, value, false);
    }

    /**
     * @dev Variant of {safeTransferFrom} that returns a bool instead of reverting if the operation is not successful.
     */
    function trySafeTransferFrom(IERC20 token, address from, address to, uint256 value) internal returns (bool) {
        return _safeTransferFrom(token, from, to, value, false);
    }

    /**
     * @dev Increase the calling contract's allowance toward `spender` by `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     *
     * IMPORTANT: If the token implements ERC-7674 (ERC-20 with temporary allowance), and if the "client"
     * smart contract uses ERC-7674 to set temporary allowances, then the "client" smart contract should avoid using
     * this function. Performing a {safeIncreaseAllowance} or {safeDecreaseAllowance} operation on a token contract
     * that has a non-zero temporary allowance (for that particular owner-spender) will result in unexpected behavior.
     */
    function safeIncreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        forceApprove(token, spender, oldAllowance + value);
    }

    /**
     * @dev Decrease the calling contract's allowance toward `spender` by `requestedDecrease`. If `token` returns no
     * value, non-reverting calls are assumed to be successful.
     *
     * IMPORTANT: If the token implements ERC-7674 (ERC-20 with temporary allowance), and if the "client"
     * smart contract uses ERC-7674 to set temporary allowances, then the "client" smart contract should avoid using
     * this function. Performing a {safeIncreaseAllowance} or {safeDecreaseAllowance} operation on a token contract
     * that has a non-zero temporary allowance (for that particular owner-spender) will result in unexpected behavior.
     */
    function safeDecreaseAllowance(IERC20 token, address spender, uint256 requestedDecrease) internal {
        unchecked {
            uint256 currentAllowance = token.allowance(address(this), spender);
            if (currentAllowance < requestedDecrease) {
                revert SafeERC20FailedDecreaseAllowance(spender, currentAllowance, requestedDecrease);
            }
            forceApprove(token, spender, currentAllowance - requestedDecrease);
        }
    }

    /**
     * @dev Set the calling contract's allowance toward `spender` to `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful. Meant to be used with tokens that require the approval
     * to be set to zero before setting it to a non-zero value, such as USDT.
     *
     * NOTE: If the token implements ERC-7674, this function will not modify any temporary allowance. This function
     * only sets the "standard" allowance. Any temporary allowance will remain active, in addition to the value being
     * set here.
     */
    function forceApprove(IERC20 token, address spender, uint256 value) internal {
        if (!_safeApprove(token, spender, value, false)) {
            if (!_safeApprove(token, spender, 0, true)) revert SafeERC20FailedOperation(address(token));
            if (!_safeApprove(token, spender, value, true)) revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} transferAndCall, with a fallback to the simple {ERC20} transfer if the target has no
     * code. This can be used to implement an {ERC721}-like safe transfer that relies on {ERC1363} checks when
     * targeting contracts.
     *
     * Reverts if the returned value is other than `true`.
     */
    function transferAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            safeTransfer(token, to, value);
        } else if (!token.transferAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} transferFromAndCall, with a fallback to the simple {ERC20} transferFrom if the target
     * has no code. This can be used to implement an {ERC721}-like safe transfer that relies on {ERC1363} checks when
     * targeting contracts.
     *
     * Reverts if the returned value is other than `true`.
     */
    function transferFromAndCallRelaxed(
        IERC1363 token,
        address from,
        address to,
        uint256 value,
        bytes memory data
    ) internal {
        if (to.code.length == 0) {
            safeTransferFrom(token, from, to, value);
        } else if (!token.transferFromAndCall(from, to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} approveAndCall, with a fallback to the simple {ERC20} approve if the target has no
     * code. This can be used to implement an {ERC721}-like safe transfer that rely on {ERC1363} checks when
     * targeting contracts.
     *
     * NOTE: When the recipient address (`to`) has no code (i.e. is an EOA), this function behaves as {forceApprove}.
     * Oppositely, when the recipient address (`to`) has code, this function only attempts to call {ERC1363-approveAndCall}
     * once without retrying, and relies on the returned value to be true.
     *
     * Reverts if the returned value is other than `true`.
     */
    function approveAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            forceApprove(token, to, value);
        } else if (!token.approveAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Imitates a Solidity `token.transfer(to, value)` call, relaxing the requirement on the return value: the
     * return value is optional (but if data is returned, it must not be false).
     *
     * @param token The token targeted by the call.
     * @param to The recipient of the tokens
     * @param value The amount of token to transfer
     * @param bubble Behavior switch if the transfer call reverts: bubble the revert reason or return a false boolean.
     */
    function _safeTransfer(IERC20 token, address to, uint256 value, bool bubble) private returns (bool success) {
        bytes4 selector = IERC20.transfer.selector;

        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(0x00, selector)
            mstore(0x04, and(to, shr(96, not(0))))
            mstore(0x24, value)
            success := call(gas(), token, 0, 0x00, 0x44, 0x00, 0x20)
            // if call success and return is true, all is good.
            // otherwise (not success or return is not true), we need to perform further checks
            if iszero(and(success, eq(mload(0x00), 1))) {
                // if the call was a failure and bubble is enabled, bubble the error
                if and(iszero(success), bubble) {
                    returndatacopy(fmp, 0x00, returndatasize())
                    revert(fmp, returndatasize())
                }
                // if the return value is not true, then the call is only successful if:
                // - the token address has code
                // - the returndata is empty
                success := and(success, and(iszero(returndatasize()), gt(extcodesize(token), 0)))
            }
            mstore(0x40, fmp)
        }
    }

    /**
     * @dev Imitates a Solidity `token.transferFrom(from, to, value)` call, relaxing the requirement on the return
     * value: the return value is optional (but if data is returned, it must not be false).
     *
     * @param token The token targeted by the call.
     * @param from The sender of the tokens
     * @param to The recipient of the tokens
     * @param value The amount of token to transfer
     * @param bubble Behavior switch if the transfer call reverts: bubble the revert reason or return a false boolean.
     */
    function _safeTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 value,
        bool bubble
    ) private returns (bool success) {
        bytes4 selector = IERC20.transferFrom.selector;

        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(0x00, selector)
            mstore(0x04, and(from, shr(96, not(0))))
            mstore(0x24, and(to, shr(96, not(0))))
            mstore(0x44, value)
            success := call(gas(), token, 0, 0x00, 0x64, 0x00, 0x20)
            // if call success and return is true, all is good.
            // otherwise (not success or return is not true), we need to perform further checks
            if iszero(and(success, eq(mload(0x00), 1))) {
                // if the call was a failure and bubble is enabled, bubble the error
                if and(iszero(success), bubble) {
                    returndatacopy(fmp, 0x00, returndatasize())
                    revert(fmp, returndatasize())
                }
                // if the return value is not true, then the call is only successful if:
                // - the token address has code
                // - the returndata is empty
                success := and(success, and(iszero(returndatasize()), gt(extcodesize(token), 0)))
            }
            mstore(0x40, fmp)
            mstore(0x60, 0)
        }
    }

    /**
     * @dev Imitates a Solidity `token.approve(spender, value)` call, relaxing the requirement on the return value:
     * the return value is optional (but if data is returned, it must not be false).
     *
     * @param token The token targeted by the call.
     * @param spender The spender of the tokens
     * @param value The amount of token to transfer
     * @param bubble Behavior switch if the transfer call reverts: bubble the revert reason or return a false boolean.
     */
    function _safeApprove(IERC20 token, address spender, uint256 value, bool bubble) private returns (bool success) {
        bytes4 selector = IERC20.approve.selector;

        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(0x00, selector)
            mstore(0x04, and(spender, shr(96, not(0))))
            mstore(0x24, value)
            success := call(gas(), token, 0, 0x00, 0x44, 0x00, 0x20)
            // if call success and return is true, all is good.
            // otherwise (not success or return is not true), we need to perform further checks
            if iszero(and(success, eq(mload(0x00), 1))) {
                // if the call was a failure and bubble is enabled, bubble the error
                if and(iszero(success), bubble) {
                    returndatacopy(fmp, 0x00, returndatasize())
                    revert(fmp, returndatasize())
                }
                // if the return value is not true, then the call is only successful if:
                // - the token address has code
                // - the returndata is empty
                success := and(success, and(iszero(returndatasize()), gt(extcodesize(token), 0)))
            }
            mstore(0x40, fmp)
        }
    }
}

// Source: node_modules/@openzeppelin/contracts/utils/StorageSlot.sol
// OpenZeppelin Contracts (last updated v5.1.0) (utils/StorageSlot.sol)
// This file was procedurally generated from scripts/generate/templates/StorageSlot.js.

/**
 * @dev Library for reading and writing primitive types to specific storage slots.
 *
 * Storage slots are often used to avoid storage conflict when dealing with upgradeable contracts.
 * This library helps with reading and writing to such slots without the need for inline assembly.
 *
 * The functions in this library return Slot structs that contain a `value` member that can be used to read or write.
 *
 * Example usage to set ERC-1967 implementation slot:
 * ```solidity
 * contract ERC1967 {
 *     // Define the slot. Alternatively, use the SlotDerivation library to derive the slot.
 *     bytes32 internal constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
 *
 *     function _getImplementation() internal view returns (address) {
 *         return StorageSlot.getAddressSlot(_IMPLEMENTATION_SLOT).value;
 *     }
 *
 *     function _setImplementation(address newImplementation) internal {
 *         require(newImplementation.code.length > 0);
 *         StorageSlot.getAddressSlot(_IMPLEMENTATION_SLOT).value = newImplementation;
 *     }
 * }
 * ```
 *
 * TIP: Consider using this library along with {SlotDerivation}.
 */
library StorageSlot {
    struct AddressSlot {
        address value;
    }

    struct BooleanSlot {
        bool value;
    }

    struct Bytes32Slot {
        bytes32 value;
    }

    struct Uint256Slot {
        uint256 value;
    }

    struct Int256Slot {
        int256 value;
    }

    struct StringSlot {
        string value;
    }

    struct BytesSlot {
        bytes value;
    }

    /**
     * @dev Returns an `AddressSlot` with member `value` located at `slot`.
     */
    function getAddressSlot(bytes32 slot) internal pure returns (AddressSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `BooleanSlot` with member `value` located at `slot`.
     */
    function getBooleanSlot(bytes32 slot) internal pure returns (BooleanSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Bytes32Slot` with member `value` located at `slot`.
     */
    function getBytes32Slot(bytes32 slot) internal pure returns (Bytes32Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Uint256Slot` with member `value` located at `slot`.
     */
    function getUint256Slot(bytes32 slot) internal pure returns (Uint256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Int256Slot` with member `value` located at `slot`.
     */
    function getInt256Slot(bytes32 slot) internal pure returns (Int256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `StringSlot` with member `value` located at `slot`.
     */
    function getStringSlot(bytes32 slot) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `StringSlot` representation of the string storage pointer `store`.
     */
    function getStringSlot(string storage store) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }

    /**
     * @dev Returns a `BytesSlot` with member `value` located at `slot`.
     */
    function getBytesSlot(bytes32 slot) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `BytesSlot` representation of the bytes storage pointer `store`.
     */
    function getBytesSlot(bytes storage store) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }
}

// Source: node_modules/@openzeppelin/contracts/utils/ReentrancyGuard.sol
// OpenZeppelin Contracts (last updated v5.5.0) (utils/ReentrancyGuard.sol)

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If EIP-1153 (transient storage) is available on the chain you're deploying at,
 * consider using {ReentrancyGuardTransient} instead.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 *
 * IMPORTANT: Deprecated. This storage-based reentrancy guard will be removed and replaced
 * by the {ReentrancyGuardTransient} variant in v6.0.
 *
 * @custom:stateless
 */
abstract contract ReentrancyGuard {
    using StorageSlot for bytes32;

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ReentrancyGuard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant REENTRANCY_GUARD_STORAGE =
        0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    constructor() {
        _reentrancyGuardStorageSlot().getUint256Slot().value = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    /**
     * @dev A `view` only version of {nonReentrant}. Use to block view functions
     * from being called, preventing reading from inconsistent contract state.
     *
     * CAUTION: This is a "view" modifier and does not change the reentrancy
     * status. Use it only on view functions. For payable or non-payable functions,
     * use the standard {nonReentrant} modifier instead.
     */
    modifier nonReentrantView() {
        _nonReentrantBeforeView();
        _;
    }

    function _nonReentrantBeforeView() private view {
        if (_reentrancyGuardEntered()) {
            revert ReentrancyGuardReentrantCall();
        }
    }

    function _nonReentrantBefore() private {
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        _nonReentrantBeforeView();

        // Any calls to nonReentrant after this point will fail
        _reentrancyGuardStorageSlot().getUint256Slot().value = ENTERED;
    }

    function _nonReentrantAfter() private {
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _reentrancyGuardStorageSlot().getUint256Slot().value = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _reentrancyGuardStorageSlot().getUint256Slot().value == ENTERED;
    }

    function _reentrancyGuardStorageSlot() internal pure virtual returns (bytes32) {
        return REENTRANCY_GUARD_STORAGE;
    }
}

// Source: contracts/src/PQVault.sol
/// @notice Immutable-clone vault: limited classical spending, delayed large transfers, always-on PQ authority.
contract PQVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    error Unauthorized();
    error InvalidInput();
    error ClassicalFrozen();
    error DailyLimitExceeded();
    error NotReady();
    error Invalidated();
    error Expired();
    error TransferFailed();
    error UnsupportedToken();
    error TooManyTransfers();

    struct Policy {
        uint256 dailyLimit;
        uint64 timelockDelay;
        uint64 coolingOff;
    }

    struct Spend {
        uint64 at;
        uint256 amount;
    }

    struct Withdrawal {
        address token;
        address to;
        uint256 amount;
        uint256 createdAtBlock;
        uint256 readyAt;
        bool done;
    }

    struct Change {
        address token;
        Policy policy;
        address rescue;
        bytes32 newKey;
        bytes32 authorizingKey;
        bool unlock;
        uint256 readyAt;
        bool done;
    }
    uint256 public constant MAX_ROLLING_TRANSFERS = 64;
    uint256 public constant DAY = 1 days;
    address public immutable factory;
    CanaryRegistry public immutable registry;
    uint64 public immutable MIN_TIMELOCK;
    uint64 public immutable MIN_COOLING_OFF;
    address public owner;
    bytes32 public pqPkHash;
    address public rescue;
    bool public locked;
    bool private initialized;
    uint256 public pqNonce;
    uint256 public withdrawalCount;
    uint256 public changeCount;
    mapping(address => Policy) public policies;
    mapping(address => Spend[64]) private spends;
    mapping(address => uint256) private spendCursor;
    mapping(address => uint256) public coolingUntil;
    mapping(uint256 => Withdrawal) public pendingWithdrawals;
    mapping(uint256 => Change) public pendingChanges;
    event Initialized(address indexed owner, bytes32 keyHash, address rescue);
    event Deposited(address indexed token, address indexed sender, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount, bool postQuantum);
    event WithdrawalRequested(uint256 indexed id, address token, address to, uint256 amount, uint256 readyAt);
    event WithdrawalCancelled(uint256 indexed id);
    event PolicyTightened(address indexed token, uint256 dailyLimit, uint64 delay, uint64 coolingOff);
    event Locked();
    event ChangeAnnounced(uint256 indexed id, uint256 readyAt, bytes32 newKey);
    event ChangeApplied(uint256 indexed id);

    constructor(CanaryRegistry sentinel, uint64 minimumDelay, uint64 minimumCooling) {
        if (address(sentinel).code.length == 0 || minimumDelay == 0 || minimumCooling == 0) revert InvalidInput();
        factory = msg.sender;
        registry = sentinel;
        MIN_TIMELOCK = minimumDelay;
        MIN_COOLING_OFF = minimumCooling;
        initialized = true; // Implementation cannot become an asset-owning user vault.
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /// @notice Bind a fresh clone once; only the immutable factory may initialize it.
    function initialize(address account, bytes32 keyHash, address destination, Policy calldata initialPolicy) external {
        if (
            msg.sender != factory || initialized || account == address(0) || keyHash == bytes32(0)
                || destination == address(0) || destination == address(this)
        ) revert InvalidInput();
        _validatePolicy(initialPolicy);
        initialized = true;
        owner = account;
        pqPkHash = keyHash;
        rescue = destination;
        locked = initialPolicy.dailyLimit == 0;
        policies[address(0)] = initialPolicy;
        emit Initialized(account, keyHash, destination);
    }

    /// @notice Native deposits. Only owner-originated deposits change the owner's cooling window.
    receive() external payable {
        if (!initialized || owner == address(0) || msg.value == 0) revert InvalidInput();
        if (msg.sender == owner) coolingUntil[address(0)] = block.timestamp + policies[address(0)].coolingOff;
        emit Deposited(address(0), msg.sender, msg.value);
    }

    /// @notice Deposit a standard ERC-20; fee-on-transfer balance deltas are rejected.
    function depositToken(address token, uint256 amount) external nonReentrant {
        if (owner == address(0) || token.code.length == 0 || amount == 0) revert InvalidInput();
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(token).balanceOf(address(this)) != beforeBalance + amount) revert UnsupportedToken();
        if (msg.sender == owner) coolingUntil[token] = block.timestamp + policies[token].coolingOff;
        emit Deposited(token, msg.sender, amount);
    }

    /// @notice Fail-closed mode and retained alarm history, including registry failures and incomplete setup.
    function mode() public view returns (bool alarm, uint256 lastBlock) {
        try registry.securityState{gas: 100000}() returns (bool tripped, uint256 priorBlock, bool ready) {
            return (tripped || !ready, priorBlock);
        } catch {
            return (true, type(uint256).max);
        }
    }

    /// @notice Exact spend in the trailing 24 hours, bounded to 64 classical releases per token.
    function rollingSpent(address token) public view returns (uint256 total) {
        for (uint256 i; i < MAX_ROLLING_TRANSFERS; ++i) {
            Spend storage entry = spends[token][i];
            if (entry.amount != 0 && block.timestamp < uint256(entry.at) + DAY) total += entry.amount;
        }
    }

    /// @notice Owner's small classical withdrawal, within the rolling limit and outside alarm/lockdown.
    function withdrawClassical(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        _classical();
        _validTransfer(amount, to);
        uint256 used = rollingSpent(token);
        uint256 limit = policies[token].dailyLimit;
        if (used > limit || amount > limit - used) revert DailyLimitExceeded();
        _recordSpend(token, amount);
        _send(token, amount, to, false);
    }

    /// @notice Queue a transfer above the rolling budget; it remains invalid after any subsequent alarm reset.
    function requestWithdrawal(address token, uint256 amount, address to) external onlyOwner returns (uint256 id) {
        _classical();
        _validTransfer(amount, to);
        Policy memory p = policies[token];
        if (p.timelockDelay < MIN_TIMELOCK) revert InvalidInput();
        uint256 used = rollingSpent(token);
        if (used <= p.dailyLimit && amount <= p.dailyLimit - used) revert InvalidInput();
        id = withdrawalCount++;
        pendingWithdrawals[id] = Withdrawal(token, to, amount, block.number, block.timestamp + p.timelockDelay, false);
        emit WithdrawalRequested(id, token, to, amount, block.timestamp + p.timelockDelay);
    }

    /// @notice Execute an owner's matured request only while classical authority is still permitted.
    function executeWithdrawal(uint256 id) external onlyOwner nonReentrant {
        _classical();
        Withdrawal storage request = pendingWithdrawals[id];
        if (id >= withdrawalCount || request.done) revert InvalidInput();
        (, uint256 lastBlock) = mode();
        if (lastBlock >= request.createdAtBlock) revert Invalidated();
        if (block.timestamp < request.readyAt) revert NotReady();
        request.done = true;
        _recordSpend(request.token, request.amount);
        _send(request.token, request.amount, request.to, false);
    }

    /// @notice Cancel a request, including while alarmed; cancellation never releases assets.
    function cancelWithdrawal(uint256 id) external onlyOwner {
        _cancel(id);
    }

    /// @notice A relayer may cancel using a valid PQ signature even if the owner key is unavailable.
    function cancelWithdrawalPQ(uint256 id, uint256 deadline, bytes calldata pk, bytes calldata sig) external {
        _authorize(keccak256(abi.encode("CANARY_CANCEL_V1", id)), deadline, pk, sig);
        _cancel(id);
    }

    /// @notice Tighten an existing token policy; no classical operation can increase authority.
    function tighten(address token, Policy calldata next) external onlyOwner {
        Policy memory current = policies[token];
        _validatePolicy(next);
        if (
            current.timelockDelay == 0 || next.dailyLimit > current.dailyLimit
                || next.timelockDelay < current.timelockDelay || next.coolingOff < current.coolingOff
        ) revert InvalidInput();
        policies[token] = next;
        emit PolicyTightened(token, next.dailyLimit, next.timelockDelay, next.coolingOff);
    }

    /// @notice Immediately freeze classical fund release; only delayed PQ authority can unlock.
    function lock() external onlyOwner {
        locked = true;
        emit Locked();
    }

    /// @notice Digest shared with the browser signer; action, chain, vault, nonce and deadline are bound.
    function authorizationDigest(bytes32 actionHash, uint256 nonce, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode("CANARY_VAULT_V1", block.chainid, address(this), nonce, deadline, actionHash));
    }

    /// @notice Withdraw with PQ authority in any mode; during alarm, the destination must be rescue.
    function withdrawPQ(
        address token,
        uint256 amount,
        address to,
        uint256 deadline,
        bytes calldata pk,
        bytes calldata sig
    ) external nonReentrant {
        _validTransfer(amount, to);
        (bool alarm,) = mode();
        if (alarm && to != rescue) revert InvalidInput();
        _authorize(keccak256(abi.encode("CANARY_WITHDRAW_V1", token, amount, to)), deadline, pk, sig);
        _send(token, amount, to, true);
    }

    /// @notice Announce a PQ-authorized policy/rescue/unlock change behind the existing timelock.
    function announceLoosen(
        address token,
        Policy calldata next,
        address nextRescue,
        bool unlock,
        uint256 deadline,
        bytes calldata pk,
        bytes calldata sig
    ) external returns (uint256 id) {
        _validatePolicy(next);
        if (nextRescue == address(0) || nextRescue == address(this)) revert InvalidInput();
        _authorize(keccak256(abi.encode("CANARY_LOOSEN_V1", token, next, nextRescue, unlock)), deadline, pk, sig);
        uint256 delay = policies[token].timelockDelay;
        if (delay < policies[address(0)].timelockDelay) delay = policies[address(0)].timelockDelay;
        id = changeCount++;
        pendingChanges[id] =
            Change(token, next, nextRescue, bytes32(0), pqPkHash, unlock, block.timestamp + delay, false);
        emit ChangeAnnounced(id, block.timestamp + delay, bytes32(0));
    }

    /// @notice Announce rotation with both old-key authorization and replacement-key proof of possession.
    function rotatePQKey(
        bytes32 newHash,
        uint256 deadline,
        bytes calldata newPk,
        bytes calldata newProof,
        bytes calldata pk,
        bytes calldata sig
    ) external returns (uint256 id) {
        if (newHash == bytes32(0) || newHash == pqPkHash) revert InvalidInput();
        bytes32 action = keccak256(abi.encode("CANARY_ROTATE_V1", newHash));
        bytes32 digest = authorizationDigest(action, pqNonce, deadline);
        PQAuth.check(newHash, digest, newPk, newProof);
        _authorize(action, deadline, pk, sig);
        id = changeCount++;
        Policy memory empty;
        uint256 ready = block.timestamp + policies[address(0)].timelockDelay;
        pendingChanges[id] = Change(address(0), empty, address(0), newHash, pqPkHash, false, ready, false);
        emit ChangeAnnounced(id, ready, newHash);
    }

    /// @notice Apply only the exact matured PQ-authorized change; old-key queued changes die on rotation.
    function applyLoosen(uint256 id) external {
        Change storage change = pendingChanges[id];
        if (id >= changeCount || change.done || change.authorizingKey != pqPkHash) revert Invalidated();
        if (block.timestamp < change.readyAt) revert NotReady();
        change.done = true;
        if (change.newKey != bytes32(0)) {
            pqPkHash = change.newKey;
        } else {
            policies[change.token] = change.policy;
            rescue = change.rescue;
            if (change.unlock) locked = false;
        }
        emit ChangeApplied(id);
    }

    /// @notice Reverse an owner deposit during cooling-off, under exactly the same alarm and daily-limit bounds.
    function reverseDeposit(address token, uint256 amount) external onlyOwner nonReentrant {
        if (block.timestamp >= coolingUntil[token]) revert Expired();
        _classical();
        _validTransfer(amount, owner);
        uint256 used = rollingSpent(token);
        uint256 limit = policies[token].dailyLimit;
        if (used > limit || amount > limit - used) revert DailyLimitExceeded();
        _recordSpend(token, amount);
        _send(token, amount, owner, false);
    }

    function _authorize(bytes32 action, uint256 deadline, bytes calldata pk, bytes calldata sig) private {
        if (block.timestamp > deadline) revert Expired();
        PQAuth.check(pqPkHash, authorizationDigest(action, pqNonce, deadline), pk, sig);
        ++pqNonce;
    }

    function _classical() private {
        if (locked) revert ClassicalFrozen();
        // A reverted withdrawal also rolls back a newly observed registry latch;
        // the independent watcher persists the alarm with a separate transaction.
        try registry.checkAndTrip{gas: 250000}() returns (bool tripped) {
            if (tripped) revert ClassicalFrozen();
        } catch {
            revert ClassicalFrozen();
        }
        (bool alarm,) = mode();
        if (alarm) revert ClassicalFrozen();
    }

    function _recordSpend(address token, uint256 amount) private {
        uint256 index = spendCursor[token] % MAX_ROLLING_TRANSFERS;
        Spend storage prior = spends[token][index];
        if (prior.amount != 0 && block.timestamp < uint256(prior.at) + DAY) revert TooManyTransfers();
        spends[token][index] = Spend(uint64(block.timestamp), amount);
        spendCursor[token] = index + 1;
    }

    function _cancel(uint256 id) private {
        if (id >= withdrawalCount || pendingWithdrawals[id].done) revert InvalidInput();
        pendingWithdrawals[id].done = true;
        emit WithdrawalCancelled(id);
    }

    function _validatePolicy(Policy memory policy) private view {
        if (policy.timelockDelay < MIN_TIMELOCK || policy.coolingOff < MIN_COOLING_OFF) revert InvalidInput();
    }

    function _validTransfer(uint256 amount, address to) private view {
        if (amount == 0 || to == address(0) || to == address(this)) revert InvalidInput();
    }

    function _send(address token, uint256 amount, address to, bool pq) private {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            uint256 beforeVault = IERC20(token).balanceOf(address(this));
            uint256 beforeRecipient = IERC20(token).balanceOf(to);
            IERC20(token).safeTransfer(to, amount);
            if (
                IERC20(token).balanceOf(address(this)) != beforeVault - amount
                    || IERC20(token).balanceOf(to) != beforeRecipient + amount
            ) revert UnsupportedToken();
        }
        emit Withdrawn(token, to, amount, pq);
    }
}

// Source: contracts/src/VaultFactory.sol
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

// Source: contracts/audit/CanaryBundle.sol
// Audit input only; no additional contract and no deployment behavior.
