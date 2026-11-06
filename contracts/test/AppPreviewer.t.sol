// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { ForkTest } from "./Fork.t.sol";
import { IAccountLoupe } from "modular-account-libs/interfaces/IAccountLoupe.sol";

import { AppPreviewer, MarketPreview, ProposalManagerPreview } from "../src/AppPreviewer.sol";
import { ExaPlugin } from "../src/ExaPlugin.sol";
import {
  IAuditor,
  IExaAccount,
  IMarket,
  IProposalManager,
  PendingProposal,
  ProposalType
} from "../src/IExaAccount.sol";
import { DeployProtocol } from "./mocks/Protocol.s.sol";

contract AppPreviewerTest is ForkTest {
  AppPreviewer internal previewer;
  DeployProtocol internal p;
  IAuditor internal auditor;

  function setUp() external {
    previewer = AppPreviewer(makeAddr("previewer"));
    vm.etch(address(previewer), type(AppPreviewer).runtimeCode);

    set("deployer", address(this));
    p = new DeployProtocol();
    p.run();
    auditor = IAuditor(address(p.auditor()));
  }

  // solhint-disable func-name-mixedcase

  function test_markets_returnsMarkets() external view {
    MarketPreview[] memory markets = previewer.markets(auditor);
    assertEq(markets.length, 3);
    assertEq(markets[0].market, address(p.exaEXA()));
    assertEq(markets[1].market, address(p.exaUSDC()));
    assertEq(markets[2].market, address(p.exaWETH()));
    assertEq(markets[0].asset, address(p.exa()));
    assertEq(markets[1].asset, address(p.usdc()));
    assertEq(markets[2].asset, address(p.weth()));
    assertEq(markets[0].decimals, 18);
    assertEq(markets[1].decimals, 6);
    assertEq(markets[2].decimals, 18);
    assertEq(markets[0].usdPrice, 5e18);
    assertEq(markets[1].usdPrice, 1e18);
    assertEq(markets[2].usdPrice, 2500e18);
    assertEq(markets[0].symbol, "EXA");
    assertEq(markets[1].symbol, "USDC");
    assertEq(markets[2].symbol, "WETH");
    for (uint256 i = 0; i < markets.length; ++i) {
      assertFalse(markets[i].nonCollateral);
      assertFalse(markets[i].isFrozen);
    }
  }

  function test_markets_returnsFrozen() external {
    p.exaUSDC().setFrozen(true);
    MarketPreview[] memory markets = previewer.markets(auditor);
    assertFalse(markets[0].isFrozen);
    assertTrue(markets[1].isFrozen);
    assertFalse(markets[2].isFrozen);
  }

  function test_markets_returnsNonCollateral() external {
    IMarket market = IMarket(address(p.exaUSDC()));
    vm.mockCall(address(auditor), abi.encodeCall(IAuditor.markets, (market)), abi.encode(auditor.markets(market), true));
    MarketPreview[] memory markets = previewer.markets(auditor);
    assertFalse(markets[0].nonCollateral);
    assertTrue(markets[1].nonCollateral);
    assertFalse(markets[2].nonCollateral);
    assertEq(markets[1].usdPrice, 1e18);
  }

  function test_pendingProposals_returnsQueuedProposals() external {
    address account = _mockAccount();
    vm.mockCall(
      makeAddr("proposalManager"),
      abi.encodeCall(IProposalManager.proposals, (account, 1)),
      abi.encode(100e6, makeAddr("market"), 1 hours, ProposalType.WITHDRAW, abi.encode(address(0x1)))
    );
    PendingProposal[] memory proposals = previewer.pendingProposals(account);
    assertEq(proposals.length, 1);
    assertEq(proposals[0].nonce, 1);
    assertEq(proposals[0].unlock, 1 hours + 1 minutes);
    assertEq(proposals[0].proposal.amount, 100e6);
    assertEq(address(proposals[0].proposal.market), makeAddr("market"));
    assertEq(proposals[0].proposal.timestamp, 1 hours);
    assertTrue(proposals[0].proposal.proposalType == ProposalType.WITHDRAW);
    assertEq(abi.decode(proposals[0].proposal.data, (address)), address(0x1));
  }

  function test_pendingProposals_returnsEmpty_whenAccountIsNotDeployed() external view {
    assertEq(previewer.pendingProposals(address(0xdead)).length, 0);
  }

  function test_pendingProposals_returnsEmpty_whenAddressIsNotAccount() external view {
    assertEq(previewer.pendingProposals(address(auditor)).length, 0);
  }

  function test_proposalManager_returnsPreview() external {
    address account = _mockAccount();
    ProposalManagerPreview memory preview = previewer.proposalManager(account);
    assertEq(preview.proposalManager, makeAddr("proposalManager"));
    assertEq(preview.delay, 1 minutes);
    assertEq(preview.queueNonce, 2);
    assertEq(preview.nonce, 1);
  }

  function test_proposalManager_returnsEmpty_whenAccountIsNotDeployed() external view {
    _assertEmpty(previewer.proposalManager(address(0xdead)));
  }

  function test_proposalManager_returnsEmpty_whenAddressIsNotAccount() external view {
    _assertEmpty(previewer.proposalManager(address(auditor)));
  }

  function test_proposalManager_returnsEmpty_whenAccountHasNoPlugin() external {
    address account = _mockAccount();
    vm.mockCall(
      account,
      abi.encodeCall(IAccountLoupe.getExecutionFunctionConfig, (IExaAccount.propose.selector)),
      abi.encode(address(0), bytes21(0), bytes21(0))
    );
    _assertEmpty(previewer.proposalManager(account));
  }

  function test_proposalManager_returnsEmpty_whenPluginHasNoProposalManager() external {
    address account = _mockAccount();
    vm.mockCallRevert(
      makeAddr("plugin"), abi.encodeCall(ExaPlugin(payable(makeAddr("plugin"))).proposalManager, ()), ""
    );
    _assertEmpty(previewer.proposalManager(account));
  }

  // solhint-enable func-name-mixedcase

  function _mockAccount() internal returns (address account) {
    account = makeAddr("account");
    address plugin = makeAddr("plugin");
    address proposalManager = makeAddr("proposalManager");
    vm.etch(account, hex"00");
    vm.etch(plugin, hex"00");
    vm.etch(proposalManager, hex"00");
    vm.mockCall(
      account,
      abi.encodeCall(IAccountLoupe.getExecutionFunctionConfig, (IExaAccount.propose.selector)),
      abi.encode(plugin, bytes21(0), bytes21(0))
    );
    vm.mockCall(plugin, abi.encodeCall(ExaPlugin(payable(plugin)).proposalManager, ()), abi.encode(proposalManager));
    vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.delay, ()), abi.encode(1 minutes));
    vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.queueNonces, (account)), abi.encode(2));
    vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.nonces, (account)), abi.encode(1));
  }

  function _assertEmpty(ProposalManagerPreview memory preview) internal pure {
    assertEq(preview.proposalManager, address(0));
    assertEq(preview.delay, 0);
    assertEq(preview.queueNonce, 0);
    assertEq(preview.nonce, 0);
  }
}
