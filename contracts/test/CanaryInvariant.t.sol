// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {CanaryFixture} from "./CanaryCore.t.sol";
import {PQVault} from "../src/PQVault.sol";
import {CanaryRegistry} from "../src/CanaryRegistry.sol";

contract VaultHandler is Test {
    PQVault public vault;
    CanaryRegistry public registry;
    address public owner;
    address public bait1;
    address public bait2;
    uint256 public released;
    uint256 public deposited;
    uint256 public expectedPqNonce;
    bool public classicalLeak;
    bool public loosened;
    bool public alarmExpected;
    bool public replayLeak;
    bool public preAlarmRequestLeak;
    bytes private publicKey;

    constructor(PQVault v, CanaryRegistry r, address account, address first, address second, bytes memory pk) {
        vault = v;
        registry = r;
        owner = account;
        bait1 = first;
        bait2 = second;
        publicKey = pk;
    }

    function spend(uint96 raw) external {
        uint256 amount = _bound(raw, 1, 2 ether);
        uint256 beforeBalance = address(vault).balance;
        bool alarm = registry.alarmed();
        vm.prank(owner);
        (bool ok,) = address(vault).call(abi.encodeCall(vault.withdrawClassical, (address(0), amount, address(0xcafe))));
        uint256 delta = beforeBalance - address(vault).balance;
        if (alarm && delta != 0) classicalLeak = true;
        if (ok) released += delta;
    }

    function tighten(uint96 raw) external {
        (uint256 prior, uint64 delay, uint64 cooling) = vault.policies(address(0));
        uint256 next = _bound(raw, 0, prior);
        vm.prank(owner);
        vault.tighten(address(0), PQVault.Policy(next, delay, cooling));
        (uint256 afterLimit,,) = vault.policies(address(0));
        if (afterLimit > prior) loosened = true;
    }

    function trip() external {
        vm.deal(bait1, 0);
        vm.deal(bait2, 0);
        registry.checkAndTrip();
        alarmExpected = true;
    }

    function advance(uint32 secondsForward) external {
        vm.warp(block.timestamp + _bound(secondsForward, 1, 2 days));
        vm.roll(block.number + 1);
    }

    function deposit(uint96 raw) external {
        uint256 amount = _bound(raw, 1, 1 ether);
        vm.deal(owner, owner.balance + amount);
        vm.prank(owner);
        (bool ok,) = address(vault).call{value: amount}("");
        if (ok) deposited += amount;
    }

    function pqExit(uint96 raw) external {
        uint256 balance = address(vault).balance;
        if (balance == 0) return;
        uint256 amount = _bound(raw, 1, balance);
        address to = vault.rescue();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 action = keccak256(abi.encode("CANARY_WITHDRAW_V1", address(0), amount, to));
        bytes32 digest = vault.authorizationDigest(action, vault.pqNonce(), deadline);
        bytes memory signature = new bytes(4627);
        bytes32 head = keccak256(abi.encode(publicKey, abi.encodePacked(digest)));
        assembly ("memory-safe") { mstore(add(signature, 32), head) }
        bytes memory payload =
            abi.encodeCall(vault.withdrawPQ, (address(0), amount, to, deadline, publicKey, signature));
        (bool ok,) = address(vault).call(payload);
        if (!ok) return;
        released += amount;
        ++expectedPqNonce;
        uint256 afterBalance = address(vault).balance;
        (bool replayed,) = address(vault).call(payload);
        if (replayed || address(vault).balance != afterBalance) replayLeak = true;
    }

    function request() external {
        vm.prank(owner);
        (bool ok,) =
            address(vault).call(abi.encodeCall(vault.requestWithdrawal, (address(0), 1.1 ether, address(0xcafe))));
        ok; // Failed requests are expected in alarm/lock mode.
    }

    function execute(uint32 raw) external {
        uint256 count = vault.withdrawalCount();
        if (count == 0) return;
        uint256 id = uint256(raw) % count;
        (,,, uint256 createdAtBlock,,) = vault.pendingWithdrawals(id);
        uint256 beforeBalance = address(vault).balance;
        bool invalid = registry.lastAlarmBlock() >= createdAtBlock;
        vm.prank(owner);
        (bool ok,) = address(vault).call(abi.encodeCall(vault.executeWithdrawal, (id)));
        if (ok) {
            uint256 delta = beforeBalance - address(vault).balance;
            released += delta;
            if (invalid && delta != 0) preAlarmRequestLeak = true;
            if (registry.alarmed() && delta != 0) classicalLeak = true;
        }
    }

    function governanceReset() external {
        if (!registry.alarmed()) return;
        vm.warp(block.timestamp + registry.minCooldown());
        vm.deal(bait1, 1 ether);
        vm.deal(bait2, 1 ether);
        // This local fixture impersonates its governance contract only to exercise
        // reset transitions. Quorum/PQ/timelock authorization is tested separately.
        vm.prank(registry.governance());
        registry.resetAlarm(keccak256("test evidence"));
        alarmExpected = false;
    }
}

contract CanaryInvariantTest is StdInvariant, CanaryFixture {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new VaultHandler(vault, registry, alice, bait1, bait2, pk);
        targetContract(address(handler));
    }

    function invariantNoClassicalReleaseDuringAlarm() public view {
        assertFalse(handler.classicalLeak());
    }

    function invariantClassicalPolicyOnlyTightens() public view {
        assertFalse(handler.loosened());
    }

    function invariantNativeAccountingConserved() public view {
        assertEq(address(vault).balance + handler.released(), 10 ether + handler.deposited());
    }

    function invariantAlarmRemainsLatched() public view {
        assertEq(registry.alarmed(), handler.alarmExpected());
    }

    function invariantPQNoncesIncreaseWithoutReplay() public view {
        assertEq(vault.pqNonce(), handler.expectedPqNonce());
        assertFalse(handler.replayLeak());
    }

    function invariantPreAlarmRequestsNeverRevive() public view {
        assertFalse(handler.preAlarmRequestLeak());
    }
}
