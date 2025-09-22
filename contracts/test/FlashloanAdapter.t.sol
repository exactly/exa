// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { IAccessControl } from "openzeppelin-contracts/contracts/access/IAccessControl.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";

import { ForkTest } from "./Fork.t.sol";

import {
  FlashLoanAdapter, IBalancerVaultV3, IFlashLoanRecipientV2, IWAToken, WATokenSet
} from "../src/FlashloanAdapter.sol";

import { console } from "forge-std/console.sol";

contract FlashloanAdapterTest is ForkTest {
  FlashLoanAdapter internal adapter;
  IBalancerVaultV3 internal vaultV3;
  address internal vaultV2;

  function setUp() external {
    vm.createSelectFork("optimism", 141_227_400);

    vaultV3 = IBalancerVaultV3(0xbA1333333333a1BA1108E8412f11850A5C319bA9);
    vaultV2 = protocol("BalancerVault");
    adapter = new FlashLoanAdapter(vaultV3, address(this));
  }

  // solhint-disable func-name-mixedcase

  function test_setWAToken_sets_whenAdmin() external {
    IERC20 asset = IERC20(address(0x1));
    IWAToken wAToken = IWAToken(address(0x2));

    adapter.setWAToken(asset, wAToken);
    assertEq(address(adapter.wATokens(asset)), address(wAToken), "wAToken not set");
  }

  function test_setWAToken_emitsWATokenSet() external {
    IERC20 asset = IERC20(address(0x1));
    IWAToken wAToken = IWAToken(address(0x2));
    vm.expectEmit(true, true, true, true, address(adapter));
    emit WATokenSet(asset, wAToken, address(this));
    adapter.setWAToken(asset, wAToken);
  }

  function test_setWAToken_reverts_whenNotAdmin() external {
    address nonAdmin = address(0x1);
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector, nonAdmin, adapter.DEFAULT_ADMIN_ROLE()
      )
    );
    adapter.setWAToken(IERC20(address(0x1)), IWAToken(address(0x2)));
    assertEq(address(adapter.wATokens(IERC20(address(0x1)))), address(0), "wAToken set");
  }

  function test_consumeAdapter() external {
    IERC20 rETH = IERC20(0x9Bcef72be871e61ED4fBbc7630889beE758eb81D);
    FlashLoanConsumer consumer = new FlashLoanConsumer(adapter, rETH);
    consumer.callFlashLoan();
  }

  function test_consumeAdapter_withAToken() external {
    IERC20 usdc = IERC20(protocol("USDC"));
    IWAToken waOptUSDCn = IWAToken(address(0x41B334E9F2C0ED1f30fD7c351874a6071C53a78E));
    adapter.setWAToken(usdc, waOptUSDCn);
    FlashLoanConsumer consumer = new FlashLoanConsumer(adapter, usdc);
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
    amounts[0] = 1e6;

    adapter.flashLoan(address(this), tokens, amounts, "");
  }

  function receiveFlashLoan(IERC20[] calldata tokens, uint256[] calldata amounts, uint256[] calldata, bytes calldata)
    external
  {
    console.log("consumer.receiveFlashLoan");
    console.log("tokens", address(tokens[0]));
    console.log("amounts", amounts[0]);
    console.log("balances", tokens[0].balanceOf(address(this)));
    tokens[0].transfer(address(adapter), amounts[0]);
    console.log("consumer transferred");
  }
}
