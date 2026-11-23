// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CanaryRegistry} from "./CanaryRegistry.sol";
import {PQAuth} from "./PQAuth.sol";

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
    /// @dev Solidity 0.8 checked addition fails closed on overflow; accepted releases also enforce the rolling budget.
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
    /// @dev nonReentrant covers recipient/token callbacks, including callbacks carrying a valid next-nonce PQ proof.
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
