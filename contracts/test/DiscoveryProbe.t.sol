// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DiscoveryProbe} from "../src/DiscoveryProbe.sol";
import {MockPQC} from "./mocks/MockPQC.sol";

contract DiscoveryProbeTest is Test {
    DiscoveryProbe internal probe;
    address internal constant VERIFIER = 0x0000000000000000000000000000000000000a01;

    function setUp() public {
        probe = new DiscoveryProbe();
    }

    function testFuzzReadsArbitraryNativeBalance(address target, uint96 amount) public {
        vm.deal(target, amount);
        assertEq(probe.nativeBalance(target), amount);
    }

    function testInactiveVerifierFailsClosed() public {
        vm.etch(VERIFIER, hex"");
        vm.expectRevert();
        probe.verify(new bytes(2592), new bytes(4627), hex"0102");
    }

    function testRejectsWrongKeySize() public {
        vm.expectRevert(DiscoveryProbe.InvalidKeyLength.selector);
        probe.verify(new bytes(2591), new bytes(4627), hex"");
    }

    function testRejectsWrongSignatureSize() public {
        vm.expectRevert(DiscoveryProbe.InvalidSignatureLength.selector);
        probe.verify(new bytes(2592), new bytes(4626), hex"");
    }

    function testDocumentedAbiPlumbingUsingTestOnlyMock() public {
        MockPQC mock = new MockPQC();
        vm.etch(VERIFIER, address(mock).code);
        assertTrue(probe.verify(new bytes(2592), new bytes(4627), hex"0102"));
    }
}
