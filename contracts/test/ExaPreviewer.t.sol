// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { ForkTest } from "./Fork.t.sol";
import { Auditor } from "@exactly/protocol/Auditor.sol";
import { FixedLib, Market } from "@exactly/protocol/Market.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";
import { OwnersLib } from "webauthn-owner-plugin/OwnersLib.sol";
import { WebauthnOwnerPlugin } from "webauthn-owner-plugin/WebauthnOwnerPlugin.sol";

import { DeployExaAccountFactory } from "../script/ExaAccountFactory.s.sol";
import { DeployExaPlugin } from "../script/ExaPlugin.s.sol";
import { DeployExaPreviewer } from "../script/ExaPreviewer.s.sol";
import { DeployIssuerChecker } from "../script/IssuerChecker.s.sol";
import { DeployProposalManager } from "../script/ProposalManager.s.sol";
import { DeployRefunder } from "../script/Refunder.s.sol";

import { ExaAccountFactory } from "../src/ExaAccountFactory.sol";
import { ExaPlugin } from "../src/ExaPlugin.sol";
import {
  Asset,
  ExaPreviewer,
  ICollectableMarket,
  IProposalManager,
  MarketPreview,
  PendingProposal,
  ProposalType
} from "../src/ExaPreviewer.sol";
import { BorrowAtMaturityData, IExaAccount, InsufficientLiquidity } from "../src/IExaAccount.sol";
import { IssuerChecker } from "../src/IssuerChecker.sol";
import { Refunder } from "../src/Refunder.sol";

import { DeployAccount } from "./mocks/Account.s.sol";
import { MockSwapper } from "./mocks/MockSwapper.sol";
import { DeployMocks } from "./mocks/Mocks.s.sol";
import { DeployProtocol } from "./mocks/Protocol.s.sol";

// solhint-disable-next-line max-states-count
contract ExaPreviewerTest is ForkTest {
  using FixedPointMathLib for uint256;
  using OwnersLib for address[];

  address internal owner;
  uint256 internal ownerKey;
  address internal issuer;
  uint256 internal issuerKey;
  address[] internal owners;
  address payable internal collector;
  IExaAccount internal account;
  ExaPlugin internal exaPlugin;
  ExaAccountFactory internal factory;
  WebauthnOwnerPlugin internal ownerPlugin;
  IssuerChecker internal issuerChecker;
  IProposalManager internal proposalManager;
  bytes32 internal domainSeparator;
  Refunder internal refunder;

  Auditor internal auditor;
  ICollectableMarket internal exaEXA;
  ICollectableMarket internal exaUSDC;
  ICollectableMarket internal exaWETH;
  MockERC20 internal exa;
  MockERC20 internal usdc;

  ExaPreviewer internal previewer;

  function setUp() external {
    collector = payable(makeAddr("collector"));
    (owner, ownerKey) = makeAddrAndKey("owner");
    owners = new address[](1);
    owners[0] = owner;
    (issuer, issuerKey) = makeAddrAndKey("issuer");

    set("admin", address(this));
    set("deployer", address(this));
    set("keeper", address(this));
    set("collector", collector);
    set("issuer", issuer);
    set("esEXA", address(0x666));
    set("RewardsController", address(0x666));

    ownerPlugin = new WebauthnOwnerPlugin();
    set("WebauthnOwnerPlugin", address(ownerPlugin));

    DeployAccount a = new DeployAccount();
    a.run();

    DeployProtocol p = new DeployProtocol();
    p.run();
    auditor = p.auditor();
    exaEXA = ICollectableMarket(address(p.exaEXA()));
    exaUSDC = ICollectableMarket(address(p.exaUSDC()));
    exaWETH = ICollectableMarket(address(p.exaWETH()));
    exa = p.exa();
    usdc = p.usdc();
    set("USDC", address(usdc));
    set("Auditor", address(auditor));
    set("MarketUSDC", address(exaUSDC));
    set("MarketWETH", address(exaWETH));
    set("Balancer2Vault", address(p.balancer()));
    set("DebtManager", address(p.debtManager()));
    set("InstallmentsRouter", address(p.installmentsRouter()));

    DeployIssuerChecker ic = new DeployIssuerChecker();
    ic.run();
    issuerChecker = ic.issuerChecker();
    set("IssuerChecker", address(issuerChecker));

    DeployMocks m = new DeployMocks();
    m.run();
    set("swapper", address(m.swapper()));

    DeployRefunder r = new DeployRefunder();
    r.run();
    refunder = r.refunder();

    DeployProposalManager pm = new DeployProposalManager();
    pm.run();
    proposalManager = pm.proposalManager();
    set("ProposalManager", address(proposalManager));

    DeployExaPlugin pl = new DeployExaPlugin();
    pl.run();
    exaPlugin = pl.exaPlugin();
    set("ExaPlugin", address(exaPlugin));

    DeployExaAccountFactory f = new DeployExaAccountFactory();
    f.run();
    factory = f.factory();
    domainSeparator = issuerChecker.DOMAIN_SEPARATOR();

    DeployExaPreviewer ep = new DeployExaPreviewer();
    ep.run();
    previewer = ep.previewer();

    account = IExaAccount(payable(factory.createAccount(0, owners.toPublicKeys())));
    vm.deal(address(account), 10_000 ether);
    vm.label(address(account), "account");

    exa.mint(address(account), 10_000e18);
    usdc.mint(address(account), 100_000e6);

    vm.stopPrank();

    vm.store(
      address(exaPlugin),
      keccak256(abi.encode(previewer, keccak256(abi.encode(keccak256("KEEPER_ROLE"), uint256(0))))),
      bytes32(uint256(1))
    );
  }

  // solhint-disable func-name-mixedcase

  function test_utilizations_returns() external view {
    previewer.utilizations();
  }

  function test_pendingProposals_returnsPendingProposals() external {
    account.poke(exaEXA);
    account.poke(exaUSDC);

    vm.startPrank(address(account));
    account.propose(exaEXA, 100e18, ProposalType.WITHDRAW, abi.encode(address(0x1)));
    account.propose(exaUSDC, 10e6, ProposalType.WITHDRAW, abi.encode(address(0x2)));
    uint256 timestamp = block.timestamp;

    PendingProposal[] memory pendingProposals = previewer.pendingProposals(address(account));
    assertEq(pendingProposals.length, 2);
    assertEq(pendingProposals[0].nonce, 0);
    assertEq(pendingProposals[1].nonce, 1);
    assertEq(pendingProposals[0].unlock, timestamp + proposalManager.delay());
    assertEq(pendingProposals[1].unlock, timestamp + proposalManager.delay());
    assertEq(pendingProposals[0].proposal.amount, 100e18);
    assertEq(pendingProposals[1].proposal.amount, 10e6);
    assertTrue(pendingProposals[0].proposal.market == exaEXA);
    assertTrue(pendingProposals[1].proposal.market == exaUSDC);
    assertTrue(pendingProposals[0].proposal.proposalType == ProposalType.WITHDRAW);
    assertTrue(pendingProposals[1].proposal.proposalType == ProposalType.WITHDRAW);
    assertEq(pendingProposals[0].proposal.timestamp, timestamp);
    assertEq(pendingProposals[1].proposal.timestamp, timestamp);
    assertEq(abi.decode(pendingProposals[0].proposal.data, (address)), address(0x1));
    assertEq(abi.decode(pendingProposals[1].proposal.data, (address)), address(0x2));

    skip(proposalManager.delay());
    account.executeProposal(proposalManager.nonces(address(account)));

    pendingProposals = previewer.pendingProposals(address(account));
    assertEq(pendingProposals.length, 1);
    assertEq(pendingProposals[0].nonce, 1);
    assertEq(pendingProposals[0].proposal.amount, 10e6);
    assertTrue(pendingProposals[0].proposal.market == exaUSDC);
    assertTrue(pendingProposals[0].proposal.proposalType == ProposalType.WITHDRAW);
    assertEq(pendingProposals[0].proposal.timestamp, timestamp);
    assertEq(abi.decode(pendingProposals[0].proposal.data, (address)), address(0x2));

    account.executeProposal(proposalManager.nonces(address(account)));

    pendingProposals = previewer.pendingProposals(address(account));
    assertEq(pendingProposals.length, 0);
  }

  function test_collect_reverts_whenProposalsLeaveNoLiquidity() external {
    account.poke(exaUSDC);

    vm.startPrank(address(account));
    account.propose(exaUSDC, exaUSDC.balanceOf(address(account)), ProposalType.WITHDRAW, abi.encode(address(0x1)));

    vm.expectRevert(InsufficientLiquidity.selector);
    previewer.collectCredit(
      FixedLib.INTERVAL, 100e6, type(uint256).max, block.timestamp, _issuerOp(100e6, block.timestamp)
    );

    vm.expectRevert(InsufficientLiquidity.selector);
    previewer.collectDebit(100e6, block.timestamp, _issuerOp(100e6, block.timestamp));
  }

  function test_collect_reverts_whenProposalsHaveTooMuchDebt() external {
    account.poke(exaUSDC);

    (uint256 adjustFactor,,,,) = auditor.markets(Market(address(exaUSDC)));

    uint256 adjustedCollateral = exaUSDC.maxWithdraw(address(account)).mulWad(adjustFactor);
    uint256 maxDebt = adjustedCollateral.mulWad(adjustFactor);

    vm.startPrank(address(account));
    // propose borrow at maturity 3 times with maxAssets = maxDebt / 3
    for (uint256 i = 0; i < 3; ++i) {
      account.propose(
        exaUSDC,
        maxDebt / 3,
        ProposalType.BORROW_AT_MATURITY,
        abi.encode(
          BorrowAtMaturityData({ maturity: FixedLib.INTERVAL, maxAssets: maxDebt / 3, receiver: address(account) })
        )
      );
    }

    vm.expectRevert(InsufficientLiquidity.selector);
    previewer.collectDebit(10, block.timestamp, _issuerOp(10, block.timestamp));

    vm.expectRevert(InsufficientLiquidity.selector);
    previewer.collectCredit(
      FixedLib.INTERVAL,
      maxDebt / 3 - 100e6,
      maxDebt / 3,
      block.timestamp,
      _issuerOp(maxDebt / 3 - 100e6, block.timestamp)
    );
  }

  function test_collect_reverts_whenProposalsHaveTooMuchRollDebt() external {
    account.poke(exaUSDC);

    (uint256 adjustFactor,,,,) = auditor.markets(Market(address(exaUSDC)));

    uint256 adjustedCollateral = exaUSDC.maxWithdraw(address(account)).mulWad(adjustFactor);
    uint256 maxDebt = adjustedCollateral.mulWad(adjustFactor);

    vm.startPrank(address(account));
    account.propose(exaUSDC, maxDebt, ProposalType.ROLL_DEBT, "");

    vm.expectRevert(InsufficientLiquidity.selector);
    previewer.collectDebit(10, block.timestamp, _issuerOp(10, block.timestamp));
  }

  function test_collectCollateral_collects() external {
    account.poke(exaEXA);
    account.poke(exaUSDC);

    uint256 maxAmountIn = 111e18;
    uint256 minAmountOut = 110e6;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountOut, (exaEXA.asset(), maxAmountIn, address(usdc), minAmountOut, address(exaPlugin))
    );

    uint256 balanceIn = exaEXA.balanceOf(address(account));
    uint256 balanceOut = exaUSDC.balanceOf(address(account));

    vm.startPrank(address(account));
    previewer.collectCollateral(
      minAmountOut, exaEXA, maxAmountIn, block.timestamp, route, _issuerOp(minAmountOut, block.timestamp)
    );

    assertGe(exaEXA.balanceOf(address(account)), balanceIn - maxAmountIn);
    assertGe(exaUSDC.balanceOf(address(account)), balanceOut);
  }

  function test_collectInstallments_collects() external {
    account.poke(exaUSDC);

    uint256[] memory amounts = new uint256[](3);
    amounts[0] = 10e6;
    amounts[1] = 10e6;
    amounts[2] = 10e6;

    vm.startPrank(address(account));
    previewer.collectInstallments(
      FixedLib.INTERVAL, amounts, type(uint256).max, block.timestamp, _issuerOp(30e6, block.timestamp)
    );

    assertEq(usdc.balanceOf(address(exaPlugin.collector())), 30e6);
  }

  function test_assets_returnsAssets() external view {
    Asset[] memory assets = previewer.assets();
    assertEq(assets.length, 3);
    assertTrue(assets[0].market == address(exaEXA));
    assertTrue(assets[1].market == address(exaUSDC));
    assertTrue(assets[2].market == address(exaWETH));
    assertTrue(assets[0].asset == exaEXA.asset());
    assertTrue(assets[1].asset == exaUSDC.asset());
    assertTrue(assets[2].asset == exaWETH.asset());
  }

  function test_markets_returnsMarkets() external view {
    MarketPreview[] memory markets = previewer.markets();
    assertEq(markets.length, 3);
    assertEq(markets[0].market, address(exaEXA));
    assertEq(markets[1].market, address(exaUSDC));
    assertEq(markets[2].market, address(exaWETH));
    assertEq(markets[0].asset, exaEXA.asset());
    assertEq(markets[1].asset, exaUSDC.asset());
    assertEq(markets[2].asset, exaWETH.asset());
    assertEq(markets[0].decimals, 18);
    assertEq(markets[1].decimals, 6);
    assertEq(markets[2].decimals, 18);
    assertEq(markets[0].usdPrice, 5e18);
    assertEq(markets[1].usdPrice, 1e18);
    assertEq(markets[2].usdPrice, 2500e18);
    assertEq(markets[0].symbol, "EXA");
    assertEq(markets[1].symbol, "USDC");
    assertEq(markets[2].symbol, "WETH");
  }

  // solhint-enable func-name-mixedcase

  function _issuerOp(uint256 amount, uint256 timestamp) internal view returns (bytes memory signature) {
    return _sign(
      issuerKey,
      keccak256(
        abi.encodePacked(
          "\x19\x01",
          domainSeparator,
          keccak256(
            abi.encode(
              keccak256(bytes("Collection(address account,uint256 amount,uint40 timestamp)")),
              account,
              amount,
              timestamp
            )
          )
        )
      )
    );
  }

  function _sign(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory) {
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
    return abi.encodePacked(r, s, v);
  }
}
