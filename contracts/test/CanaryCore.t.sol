// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CanaryRegistry} from "../src/CanaryRegistry.sol";
import {PQVault} from "../src/PQVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {PQGovernance} from "../src/PQGovernance.sol";
import {PQAuth} from "../src/PQAuth.sol";
import {MockBoundPQC} from "./mocks/MockBoundPQC.sol";
import {MockToken, MockFeeToken} from "./mocks/MockToken.sol";
import {MockReentrantRecipient} from "./mocks/MockReentrantRecipient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

abstract contract CanaryFixture is Test {
    address constant VERIFIER = 0x0000000000000000000000000000000000000a01;
    address internal alice = address(0xa11ce);
    address internal rescue = address(0xb0a7);
    address internal bait1 = address(0xba17);
    address internal bait2 = address(0xba18);
    address internal recipient = address(0xcafe);
    CanaryRegistry internal registry;
    VaultFactory internal factory;
    PQVault internal vault;
    bytes internal pk;
    PQVault.Policy internal policy;

    function setUp() public virtual {
        vm.roll(100);
        vm.warp(100000);
        vm.chainId(9800);
        MockBoundPQC mock = new MockBoundPQC();
        vm.etch(VERIFIER, address(mock).code);
        registry = new CanaryRegistry(address(this), 2, 100, 1 hours);
        vm.deal(bait1, 1 ether);
        vm.deal(bait2, 1 ether);
        registry.addCanary(bait1, bytes32(uint256(1)));
        registry.addCanary(bait2, bytes32(uint256(2)));
        factory = new VaultFactory(registry, 1 hours, 10 minutes);
        pk = new bytes(2592);
        pk[0] = 0x01;
        policy = PQVault.Policy(1 ether, 1 days, 1 hours);
        vault = _create(policy);
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        (bool ok,) = address(vault).call{value: 10 ether}("");
        require(ok);
    }

    function _create(PQVault.Policy memory p) internal returns (PQVault result) {
        bytes32 digest = factory.bindingDigest(alice, keccak256(pk), rescue, p);
        bytes memory proof = _sig(pk, digest);
        vm.prank(alice);
        result = PQVault(payable(factory.createVault(alice, keccak256(pk), rescue, p, pk, proof)));
    }

    function _sig(bytes memory key, bytes32 digest) internal pure returns (bytes memory signature) {
        signature = new bytes(4627);
        bytes32 head = keccak256(abi.encode(key, abi.encodePacked(digest)));
        assembly ("memory-safe") { mstore(add(signature, 32), head) }
    }

    function _withdrawProof(PQVault target, uint256 amount, address to, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 action = keccak256(abi.encode("CANARY_WITHDRAW_V1", address(0), amount, to));
        return _sig(pk, target.authorizationDigest(action, target.pqNonce(), deadline));
    }

    function _trip() internal {
        vm.roll(block.number + 1);
        vm.deal(bait1, 0);
        vm.deal(bait2, 0);
        registry.checkAndTrip();
    }
}

contract CanaryCoreTest is CanaryFixture {
    function testAuditCopiedCreationProofCannotConsumeOwnerNonce() public {
        uint256 nonce = factory.creationNonce(alice);
        bytes32 digest = factory.bindingDigest(alice, keccak256(pk), rescue, policy);
        bytes memory proof = _sig(pk, digest);
        vm.prank(recipient);
        vm.expectRevert(VaultFactory.InvalidOwner.selector);
        factory.createVault(alice, keccak256(pk), rescue, policy, pk, proof);
        assertEq(factory.creationNonce(alice), nonce);
        vm.prank(alice);
        factory.createVault(alice, keccak256(pk), rescue, policy, pk, proof);
        assertEq(factory.creationNonce(alice), nonce + 1);
        vm.prank(alice);
        vm.expectRevert(PQAuth.InvalidPQProof.selector);
        factory.createVault(alice, keccak256(pk), rescue, policy, pk, proof);
    }

    function testAuditRegistryRejectsSeventeenthSlot() public {
        for (uint256 i = 2; i < 16; ++i) {
            address bait = address(uint160(0x90000 + i));
            vm.deal(bait, 1 ether);
            registry.addCanary(bait, bytes32(i + 1));
        }
        address extra = address(0x99999);
        vm.deal(extra, 1 ether);
        vm.expectRevert(CanaryRegistry.InvalidCanary.selector);
        registry.addCanary(extra, bytes32(uint256(17)));
        assertEq(registry.canaryCount(), 16);
        (,, bool ready) = registry.securityState();
        assertTrue(ready);
    }

    function testUnrelatedCallerCannotReleaseFundsOrQueueAWithdrawal() public {
        uint256 beforeBalance = address(vault).balance;
        vm.startPrank(recipient);
        vm.expectRevert(PQVault.Unauthorized.selector);
        vault.withdrawClassical(address(0), 1 ether, recipient);
        vm.expectRevert(PQVault.Unauthorized.selector);
        vault.requestWithdrawal(address(0), 2 ether, recipient);
        vm.stopPrank();
        assertEq(address(vault).balance, beforeBalance);
        assertEq(vault.withdrawalCount(), 0);
    }

    function testFuzzDrainFloorMatchesFullPrecisionMath(uint256 baseline, uint16 tolerance) public {
        baseline = bound(baseline, 10000, type(uint256).max);
        tolerance = uint16(bound(uint256(tolerance), 0, 9999));
        CanaryRegistry sentinel = new CanaryRegistry(address(this), 1, tolerance, 1);
        address bait = address(0x12345);
        vm.deal(bait, baseline);
        sentinel.addCanary(bait, bytes32(uint256(1)));
        uint256 floorBalance = Math.mulDiv(baseline, 10000 - uint256(tolerance), 10000);
        vm.deal(bait, floorBalance);
        assertEq(sentinel.drainedIndexes().length, 0);
        vm.deal(bait, floorBalance - 1);
        assertEq(sentinel.drainedIndexes().length, 1);
    }

    function testReentrancyCannotUseAnOtherwiseValidNextPQAuthorization() public {
        MockReentrantRecipient attacker = new MockReentrantRecipient();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 nestedAction = keccak256(abi.encode("CANARY_WITHDRAW_V1", address(0), 1 ether, recipient));
        bytes memory nestedProof = _sig(pk, vault.authorizationDigest(nestedAction, 1, deadline));
        attacker.configure(
            address(vault),
            abi.encodeCall(vault.withdrawPQ, (address(0), 1 ether, recipient, deadline, pk, nestedProof))
        );
        bytes memory outerProof = _withdrawProof(vault, 1 ether, address(attacker), deadline);
        vault.withdrawPQ(address(0), 1 ether, address(attacker), deadline, pk, outerProof);
        assertTrue(attacker.attempted());
        assertFalse(attacker.reentered());
        assertEq(address(vault).balance, 9 ether);
        assertEq(recipient.balance, 0);
    }

    function testKeyRotationNeedsBothProofsAndDelayAndInvalidatesOldKey() public {
        bytes memory newPk = new bytes(2592);
        newPk[0] = 0x03;
        bytes32 newHash = keccak256(newPk);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 action = keccak256(abi.encode("CANARY_ROTATE_V1", newHash));
        bytes32 digest = vault.authorizationDigest(action, 0, deadline);
        bytes memory oldProof = _sig(pk, digest);
        vm.expectRevert(PQAuth.InvalidPQProof.selector);
        vault.rotatePQKey(newHash, deadline, newPk, new bytes(4627), pk, oldProof);
        uint256 id = vault.rotatePQKey(newHash, deadline, newPk, _sig(newPk, digest), pk, oldProof);
        vm.expectRevert(PQVault.NotReady.selector);
        vault.applyLoosen(id);
        vm.warp(block.timestamp + 1 days);
        vault.applyLoosen(id);
        assertEq(vault.pqPkHash(), newHash);
        deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory proof = _withdrawProof(vault, 1 ether, recipient, deadline);
        vm.expectRevert(PQAuth.InvalidPQProof.selector);
        vault.withdrawPQ(address(0), 1 ether, recipient, deadline, pk, proof);
    }

    function testFactoryRequiresOwnerAndProofAndInitializationIsOneTime() public {
        vm.expectRevert(VaultFactory.InvalidOwner.selector);
        factory.createVault(alice, keccak256(pk), rescue, policy, pk, new bytes(4627));
        vm.prank(alice);
        vm.expectRevert(PQAuth.InvalidPQProof.selector);
        factory.createVault(alice, keccak256(pk), rescue, policy, pk, new bytes(4627));
        vm.expectRevert(PQVault.InvalidInput.selector);
        vault.initialize(alice, keccak256(pk), rescue, policy);
        assertEq(factory.vaultsOf(alice).length, 1);
    }

    function testClassicalRollingLimitHasNoMidnightReset() public {
        vm.warp(2 days - 1);
        vm.prank(alice);
        vault.withdrawClassical(address(0), 1 ether, recipient);
        vm.warp(2 days + 1);
        vm.prank(alice);
        vm.expectRevert(PQVault.DailyLimitExceeded.selector);
        vault.withdrawClassical(address(0), 1, recipient);
        vm.warp(3 days);
        vm.prank(alice);
        vault.withdrawClassical(address(0), 1 ether, recipient);
    }

    function testAlarmBlocksAllClassicalReleasesAndPQRescueWorks() public {
        vm.prank(alice);
        vault.requestWithdrawal(address(0), 3 ether, recipient);
        _trip();
        vm.warp(block.timestamp + 2 days);
        vm.startPrank(alice);
        vm.expectRevert(PQVault.ClassicalFrozen.selector);
        vault.withdrawClassical(address(0), 1, recipient);
        vm.expectRevert(PQVault.ClassicalFrozen.selector);
        vault.executeWithdrawal(0);
        vm.expectRevert();
        vault.reverseDeposit(address(0), 1);
        vm.stopPrank();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _withdrawProof(vault, 2 ether, rescue, deadline);
        vault.withdrawPQ(address(0), 2 ether, rescue, deadline, pk, proof);
        assertEq(rescue.balance, 2 ether);
        assertEq(vault.pqNonce(), 1);
    }

    function testDrainedBalancesBlockBeforeWatcherTransaction() public {
        vm.deal(bait1, 0);
        vm.deal(bait2, 0);
        vm.prank(alice);
        vm.expectRevert(PQVault.ClassicalFrozen.selector);
        vault.withdrawClassical(address(0), 1, recipient);
        assertEq(address(vault).balance, 10 ether);
        // Revert rolls back the inner latch; permissionless check persists it.
        registry.checkAndTrip();
        assertTrue(registry.alarmed());
    }

    function testRegistryFailureFailsClosedButPQRescueStillWorks() public {
        vm.mockCallRevert(address(registry), abi.encodeWithSelector(registry.securityState.selector), hex"01");
        vm.prank(alice);
        vm.expectRevert(PQVault.ClassicalFrozen.selector);
        vault.withdrawClassical(address(0), 1, recipient);
        uint256 deadline = block.timestamp + 1 hours;
        vault.withdrawPQ(address(0), 1 ether, rescue, deadline, pk, _withdrawProof(vault, 1 ether, rescue, deadline));
        assertEq(rescue.balance, 1 ether);
    }

    function testPreAlarmRequestNeverRevivesAfterReset() public {
        vm.prank(alice);
        vault.requestWithdrawal(address(0), 3 ether, recipient);
        _trip();
        uint256 lastBlock = registry.lastAlarmBlock();
        vm.warp(block.timestamp + 2 days);
        vm.roll(block.number + 1);
        vm.deal(bait1, 1 ether);
        vm.deal(bait2, 1 ether);
        registry.resetAlarm(keccak256("evidence"));
        assertEq(registry.lastAlarmBlock(), lastBlock);
        vm.prank(alice);
        vm.expectRevert(PQVault.Invalidated.selector);
        vault.executeWithdrawal(0);
    }

    function testPqProofRejectsReplayAcrossVaultsAndChainsAndExpiredDeadline() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _withdrawProof(vault, 1 ether, recipient, deadline);
        PQVault other = _create(policy);
        vm.deal(address(other), 2 ether);
        vm.expectRevert(PQAuth.InvalidPQProof.selector);
        other.withdrawPQ(address(0), 1 ether, recipient, deadline, pk, proof);
        vm.chainId(9801);
        vm.expectRevert(PQAuth.InvalidPQProof.selector);
        vault.withdrawPQ(address(0), 1 ether, recipient, deadline, pk, proof);
        vm.chainId(9800);
        vault.withdrawPQ(address(0), 1 ether, recipient, deadline, pk, proof);
        vm.expectRevert(PQAuth.InvalidPQProof.selector);
        vault.withdrawPQ(address(0), 1 ether, recipient, deadline, pk, proof);
        vm.warp(deadline + 1);
        vm.expectRevert(PQVault.Expired.selector);
        vault.withdrawPQ(address(0), 1 ether, recipient, deadline, pk, proof);
    }

    function testAlarmPQDestinationMustBeRescueAndLockDoesNotBlockPQ() public {
        vm.prank(alice);
        vault.lock();
        _trip();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory wrongDestinationProof = _withdrawProof(vault, 1 ether, recipient, deadline);
        vm.expectRevert(PQVault.InvalidInput.selector);
        vault.withdrawPQ(address(0), 1 ether, recipient, deadline, pk, wrongDestinationProof);
        vault.withdrawPQ(address(0), 1 ether, rescue, deadline, pk, _withdrawProof(vault, 1 ether, rescue, deadline));
        assertEq(rescue.balance, 1 ether);
    }

    function testClassicalTighteningCannotLoosenOrUnlock() public {
        PQVault.Policy memory stricter = PQVault.Policy(0.5 ether, 2 days, 2 hours);
        vm.prank(alice);
        vault.tighten(address(0), stricter);
        vm.prank(alice);
        vm.expectRevert(PQVault.InvalidInput.selector);
        vault.tighten(address(0), policy);
        (uint256 limit, uint64 delay,) = vault.policies(address(0));
        assertEq(limit, 0.5 ether);
        assertEq(delay, 2 days);
    }

    function testLooseningRequiresPQAndDelay() public {
        PQVault.Policy memory next = PQVault.Policy(2 ether, 1 hours, 10 minutes);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 action = keccak256(abi.encode("CANARY_LOOSEN_V1", address(0), next, rescue, true));
        bytes memory proof = _sig(pk, vault.authorizationDigest(action, vault.pqNonce(), deadline));
        uint256 id = vault.announceLoosen(address(0), next, rescue, true, deadline, pk, proof);
        vm.expectRevert(PQVault.NotReady.selector);
        vault.applyLoosen(id);
        vm.warp(block.timestamp + 1 days);
        vault.applyLoosen(id);
        (uint256 limit,,) = vault.policies(address(0));
        assertEq(limit, 2 ether);
        vm.expectRevert(PQVault.Invalidated.selector);
        vault.applyLoosen(id);
    }

    function testStrictVaultStartsLocked() public {
        policy.dailyLimit = 0;
        PQVault strict = _create(policy);
        assertTrue(strict.locked());
        vm.prank(alice);
        vm.expectRevert(PQVault.ClassicalFrozen.selector);
        strict.requestWithdrawal(address(0), 1 ether, recipient);
    }

    function testTokenDepositsRejectTransferFees() public {
        MockFeeToken token = new MockFeeToken();
        token.mint(alice, 1000 ether);
        vm.startPrank(alice);
        token.approve(address(vault), 1 ether);
        vm.expectRevert(PQVault.UnsupportedToken.selector);
        vault.depositToken(address(token), 1 ether);
        vm.stopPrank();
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function testStandardTokenPqAccounting() public {
        MockToken token = new MockToken();
        token.mint(alice, 10 ether);
        vm.startPrank(alice);
        token.approve(address(vault), 10 ether);
        vault.depositToken(address(token), 10 ether);
        vm.stopPrank();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 action = keccak256(abi.encode("CANARY_WITHDRAW_V1", address(token), 3 ether, recipient));
        vault.withdrawPQ(
            address(token), 3 ether, recipient, deadline, pk, _sig(pk, vault.authorizationDigest(action, 0, deadline))
        );
        assertEq(token.balanceOf(address(vault)), 7 ether);
        assertEq(token.balanceOf(recipient), 3 ether);
    }

    function testRollingTransferStorageBoundFailsClosed() public {
        vm.startPrank(alice);
        for (uint256 i; i < 64; ++i) {
            vault.withdrawClassical(address(0), 1, recipient);
        }
        vm.expectRevert(PQVault.TooManyTransfers.selector);
        vault.withdrawClassical(address(0), 1, recipient);
        vm.stopPrank();
    }

    function testFuzzClassicalAuthorityNeverExceedsRollingBudget(uint256 amount) public {
        amount = bound(amount, 1, 2 ether);
        uint256 beforeBalance = address(vault).balance;
        vm.prank(alice);
        if (amount > policy.dailyLimit) vm.expectRevert(PQVault.DailyLimitExceeded.selector);
        vault.withdrawClassical(address(0), amount, recipient);
        assertLe(beforeBalance - address(vault).balance, policy.dailyLimit);
    }

    function testAlarmLatchThresholdAndCooldown() public {
        vm.deal(bait1, 0);
        assertFalse(registry.checkAndTrip());
        vm.deal(bait2, 0);
        assertTrue(registry.checkAndTrip());
        vm.deal(bait1, 1 ether);
        vm.deal(bait2, 1 ether);
        assertTrue(registry.checkAndTrip());
        vm.expectRevert(CanaryRegistry.CooldownActive.selector);
        registry.resetAlarm(keccak256("evidence"));
        vm.warp(block.timestamp + 1 hours);
        registry.resetAlarm(keccak256("evidence"));
        assertFalse(registry.alarmed());
    }

    function testTopUpMaskingIsExplicitResidualRisk() public {
        vm.deal(bait1, 0);
        vm.deal(bait2, 0);
        vm.deal(bait1, 1 ether);
        vm.deal(bait2, 1 ether);
        assertFalse(registry.checkAndTrip());
    }

    function testGuardianQuorumTimelockAndDuplicateSignerRejection() public {
        bytes memory pk2 = new bytes(2592);
        pk2[0] = 0x02;
        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = keccak256(pk);
        hashes[1] = keccak256(pk2);
        PQGovernance gov = new PQGovernance(hashes, 2, 1 hours);
        CanaryRegistry governed = new CanaryRegistry(address(gov), 1, 100, 1 hours);
        bytes memory data = abi.encodeCall(governed.addCanary, (bait1, bytes32(uint256(9))));
        uint256 deadline = block.timestamp + 2 hours;
        bytes32 digest = gov.actionDigest(address(governed), data, 0, deadline);
        uint256[] memory indexes = new uint256[](2);
        indexes[1] = 1;
        bytes[] memory pks = new bytes[](2);
        pks[0] = pk;
        pks[1] = pk2;
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(pk, digest);
        sigs[1] = _sig(pk2, digest);
        indexes[1] = 0;
        vm.expectRevert(PQGovernance.InvalidProposal.selector);
        gov.queue(address(governed), data, deadline, indexes, pks, sigs);
        indexes[1] = 1;
        gov.queue(address(governed), data, deadline, indexes, pks, sigs);
        vm.expectRevert(PQGovernance.NotReady.selector);
        gov.execute(address(governed), data, 0, deadline);
        vm.warp(block.timestamp + 1 hours);
        gov.execute(address(governed), data, 0, deadline);
        assertEq(governed.canaryCount(), 1);
        vm.expectRevert(PQGovernance.NotReady.selector);
        gov.execute(address(governed), data, 0, deadline);
    }
}
