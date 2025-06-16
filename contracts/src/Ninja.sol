// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import { Auditor, FixedLib, Market } from "@exactly/protocol/Market.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

contract Ninja {
  Auditor internal auditor;
  Market internal marketUSDC;
  Market internal marketWETH;
  MockERC20 internal usdc;

  constructor() {
    auditor = Auditor(0x7299b566bAa22F5C0F759b7598EeE4a219AdD2D3);
    marketUSDC = Market(0xe0b89008304552823335Dc2d99783B9Ed74b1107);
    marketWETH = Market(0x1d42a3bb545ABAe142a98d91D590b99cA9236367);
    usdc = MockERC20(address(marketUSDC.asset()));

    auditor.enterMarket(marketUSDC);
    auditor.enterMarket(marketWETH);
    auditor.exitMarket(marketUSDC);
    auditor.exitMarket(marketWETH);

    usdc.mint(address(this), 2000e6);
    usdc.approve(address(marketUSDC), type(uint256).max);
    marketUSDC.deposit(1000e6, address(this));

    uint256 borrowShares = marketUSDC.borrow(100e6, address(this), address(this));
    marketUSDC.refund(borrowShares, address(this));

    uint256 nextMaturity = block.timestamp - (block.timestamp % FixedLib.INTERVAL) + FixedLib.INTERVAL;

    uint256 positionAssets = marketUSDC.borrowAtMaturity(nextMaturity, 100e6, 110e6, address(this), address(this));
    marketUSDC.repayAtMaturity(nextMaturity, positionAssets, positionAssets, address(this));

    positionAssets = marketUSDC.borrowAtMaturity(nextMaturity, 100e6, 110e6, address(this), address(this));
    marketUSDC.repayAtMaturity(nextMaturity, positionAssets, positionAssets, address(this));

    marketUSDC.borrowAtMaturity(nextMaturity + FixedLib.INTERVAL, 100e6, 110e6, address(this), address(this));
    marketUSDC.repayAtMaturity(nextMaturity + FixedLib.INTERVAL, 80e6, 100e6, address(this));
    marketUSDC.borrowAtMaturity(nextMaturity + FixedLib.INTERVAL, 100e6, 110e6, address(this), address(this));
    marketUSDC.repayAtMaturity(nextMaturity + FixedLib.INTERVAL, 80e6, 100e6, address(this));
  }
}
