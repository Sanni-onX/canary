// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {DiscoveryProbe} from "../src/DiscoveryProbe.sol";

/// @notice Deploy only the read-only discovery probe, using a local signing key.
contract DiscoveryProbeScript is Script {
    /// @notice A live testnet EVM window is required before broadcasting.
    function run() external returns (DiscoveryProbe probe) {
        require(block.chainid == 9800, "Canary: testnet only");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        probe = new DiscoveryProbe();
        vm.stopBroadcast();
        console.log("DiscoveryProbe", address(probe));
    }
}
