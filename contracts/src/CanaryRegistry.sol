// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

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
    /// @dev At most MAX_CANARIES (16) slots: addCanary enforces the cap and replacement never appends.
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
