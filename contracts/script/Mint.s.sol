// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { BaseScript } from "./Base.s.sol";

contract MintScript is BaseScript {
  using SafeTransferLib for address payable;
  using SafeTransferLib for address;

  function run() external {
    vm.createSelectFork("base_sepolia");
    MockERC20 usdc = MockERC20(protocol("USDC"));
    address deployer = acct("deployer");
    address payable account = payable(0x7e3F5885d9EEA2959F8716954a4C2ca37Ee2eEC1);

    vm.startBroadcast(deployer);
    usdc.mint(account, 100e6);
    // usdc.mint(deployer, 100e6);
    // address(usdc).safeTransfer(account, 100e6);
    // account.safeTransferETH(100);
    vm.stopBroadcast();
  }
}
