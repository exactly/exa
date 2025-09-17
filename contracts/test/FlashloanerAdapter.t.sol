// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";

import { ForkTest } from "./Fork.t.sol";

import { FlashLoanAdapter, IBalancerVaultV3, IFlashLoanRecipientV2 } from "../src/FlashloanAdapter.sol";


contract FlashloanAdapterTest is ForkTest {
  FlashLoanAdapter internal adapter;
  IBalancerVaultV3 internal vaultV3;
  address internal vaultV2;

  function setUp() external {
    vaultV3 = IBalancerVaultV3(0xbA1333333333a1BA1108E8412f11850A5C319bA9);
    adapter = new FlashLoanAdapter(vaultV3);
  }

  // solhint-disable func-name-mixedcase

  function test_consumeAdapter() external {
    vm.createSelectFork("optimism", 141_227_400);

    vaultV3 = IBalancerVaultV3(0xbA1333333333a1BA1108E8412f11850A5C319bA9);
    vaultV2 = protocol("BalancerVault");
    adapter = new FlashLoanAdapter(vaultV3);

    IERC20 rETH = IERC20(0x9Bcef72be871e61ED4fBbc7630889beE758eb81D);
    FlashLoanConsumer consumer = new FlashLoanConsumer(adapter, rETH);
    consumer.callFlashLoan();
  }

  // solhint-enable func-name-mixedcase
}

contract FlashLoanConsumer is IFlashLoanRecipientV2 {
  FlashLoanAdapter internal adapter;
  IERC20 internal token;

  constructor(FlashLoanAdapter adapter_, IERC20 token_) {
    adapter = adapter_;
    token = token_;
  }

  function callFlashLoan() external {
    IERC20[] memory tokens = new IERC20[](1);
    tokens[0] = token;
    uint256[] memory amounts = new uint256[](1);
    amounts[0] = 1 ether;

    adapter.flashLoan(address(this), tokens, amounts, "");
  }

  function receiveFlashLoan(IERC20[] calldata tokens, uint256[] calldata amounts, uint256[] calldata, bytes calldata)
    external
  {
    tokens[0].transfer(address(adapter), amounts[0]);
  }
}
