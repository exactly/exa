// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { IAccessControl } from "openzeppelin-contracts/contracts/access/IAccessControl.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";

import { ForkTest } from "./Fork.t.sol";

import {
  ATokenSet, FlashLoanAdapter, IAToken, IBalancerVaultV3, IFlashLoanRecipientV2
} from "../src/FlashloanAdapter.sol";

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

  function test_setAToken_sets_whenAdmin() external {
    IERC20 asset = IERC20(address(0x1));
    IAToken aToken = IAToken(address(0x2));

    adapter.setAToken(asset, aToken);
    assertEq(address(adapter.aTokens(asset)), address(aToken), "aToken not set");
  }

  function test_setAToken_emitsATokenSet() external {
    IERC20 asset = IERC20(address(0x1));
    IAToken aToken = IAToken(address(0x2));
    vm.expectEmit(true, true, true, true, address(adapter));
    emit ATokenSet(asset, aToken, address(this));
    adapter.setAToken(asset, aToken);
  }

  function test_setAToken_reverts_whenNotAdmin() external {
    address nonAdmin = address(0x1);
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector, nonAdmin, adapter.DEFAULT_ADMIN_ROLE()
      )
    );
    adapter.setAToken(IERC20(address(0x1)), IAToken(address(0x2)));
    assertEq(address(adapter.aTokens(IERC20(address(0x1)))), address(0), "aToken set");
  }

  function test_consumeAdapter() external {
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
