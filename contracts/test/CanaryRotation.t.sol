// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CanaryFixture} from "./CanaryCore.t.sol";
import {CanaryRegistry} from "../src/CanaryRegistry.sol";
import {PQVault} from "../src/PQVault.sol";

contract CanaryRotationTest is CanaryFixture {
    function testRepeatedEpochRotationKeepsSixteenSlotsAndReadiness() public {
        for (uint256 i; i < 14; ++i) {
            address account = address(uint160(0x10000 + i));
            vm.deal(account, 1 ether);
            registry.addCanary(account, bytes32(i + 100));
        }
        for (uint256 i; i < 32; ++i) {
            address account = address(uint160(0x20000 + i));
            vm.deal(account, 1 ether);
            registry.replaceCanary(i % 16, account, bytes32(i + 200));
            assertEq(registry.canaryCount(), 16);
            (bool alarm,, bool ready) = registry.securityState();
            assertFalse(alarm);
            assertTrue(ready);
        }
        assertTrue(registry.usedCanary(bait1));
    }

    function testRotationRequiresGovernanceFreshFundedAccountAndExposure() public {
        address fresh = address(0x30000);
        vm.deal(fresh, 1 ether);
        vm.prank(alice);
        vm.expectRevert(CanaryRegistry.Unauthorized.selector);
        registry.replaceCanary(0, fresh, bytes32(uint256(1)));
        vm.expectRevert(CanaryRegistry.InvalidCanary.selector);
        registry.replaceCanary(2, fresh, bytes32(uint256(1)));
        vm.expectRevert(CanaryRegistry.InvalidCanary.selector);
        registry.replaceCanary(0, fresh, bytes32(0));
        vm.expectRevert(CanaryRegistry.InvalidCanary.selector);
        registry.replaceCanary(0, bait2, bytes32(uint256(1)));
        vm.expectRevert(CanaryRegistry.InvalidCanary.selector);
        registry.replaceCanary(0, address(0x44444), bytes32(uint256(1)));
        registry.replaceCanary(0, fresh, bytes32(uint256(1)));
        vm.expectRevert(CanaryRegistry.InvalidCanary.selector);
        registry.replaceCanary(0, bait1, bytes32(uint256(2)));
        vm.expectRevert(CanaryRegistry.InvalidCanary.selector);
        registry.addCanary(bait1, bytes32(uint256(2)));
    }

    function testReplacingDrainedCanaryFirstLatchesOldThresholdEvidence() public {
        vm.deal(bait1, 0);
        vm.deal(bait2, 0);
        address fresh = address(0x30000);
        vm.deal(fresh, 1 ether);
        vm.roll(block.number + 1);
        registry.replaceCanary(0, fresh, bytes32(uint256(3)));
        assertTrue(registry.alarmed());
        assertEq(registry.lastAlarmBlock(), block.number);
        assertEq(registry.drainedIndexes().length, 1);
    }

    function testRetiringDrainedCanaryCannotHideThresholdBreach() public {
        address extra = address(0x30000);
        vm.deal(extra, 1 ether);
        registry.addCanary(extra, bytes32(uint256(3)));
        vm.deal(bait1, 0);
        vm.deal(bait2, 0);
        registry.retireCanary(0);
        assertTrue(registry.alarmed());
        vm.deal(address(0x40000), 1 ether);
        registry.replaceCanary(0, address(0x40000), bytes32(uint256(4)));
        (,,,, bool retired) = registry.canaries(0);
        assertFalse(retired);
        (,, bool ready) = registry.securityState();
        assertTrue(ready);
    }

    function testRotationAndResetNeverReviveAnOldWithdrawal() public {
        vm.prank(alice);
        uint256 id = vault.requestWithdrawal(address(0), 2 ether, recipient);
        _trip();
        uint256 alarmBlock = registry.lastAlarmBlock();
        for (uint256 i; i < 2; ++i) {
            address fresh = address(uint160(0x30000 + i));
            vm.deal(fresh, 1 ether);
            registry.replaceCanary(i, fresh, bytes32(i + 3));
        }
        assertTrue(registry.alarmed());
        assertEq(registry.lastAlarmBlock(), alarmBlock);
        vm.warp(block.timestamp + 2 days);
        registry.resetAlarm(keccak256("new epoch evidence"));
        vm.prank(alice);
        vm.expectRevert(PQVault.Invalidated.selector);
        vault.executeWithdrawal(id);
    }
}
