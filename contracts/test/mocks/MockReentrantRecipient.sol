// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockReentrantRecipient {
    address public target;
    bytes public payload;
    bool public attempted;
    bool public reentered;

    function configure(address account, bytes calldata data) external {
        target = account;
        payload = data;
    }

    receive() external payable {
        attempted = true;
        (reentered,) = target.call(payload);
    }
}
