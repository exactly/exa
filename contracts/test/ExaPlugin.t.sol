// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0; // solhint-disable-line one-contract-per-file

import { ForkTest, stdError } from "./Fork.t.sol";

import { Auditor } from "@exactly/protocol/Auditor.sol";
import { FixedLib, Market } from "@exactly/protocol/Market.sol";

import { PluginManagerInternals } from "modular-account/src/account/PluginManagerInternals.sol";
import { Call, UpgradeableModularAccount } from "modular-account/src/account/UpgradeableModularAccount.sol";
import { IEntryPoint } from "modular-account/src/interfaces/erc4337/IEntryPoint.sol";

import {
  ManifestAssociatedFunction,
  ManifestAssociatedFunctionType,
  ManifestFunction,
  PluginManifest
} from "modular-account-libs/interfaces/IPlugin.sol";
import { FunctionReference } from "modular-account-libs/interfaces/IPluginManager.sol";
import { UserOperation } from "modular-account-libs/interfaces/UserOperation.sol";
import { BasePlugin, PluginMetadata } from "modular-account-libs/plugins/BasePlugin.sol";

import { IAccessControl } from "openzeppelin-contracts/contracts/access/IAccessControl.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { IERC4626 } from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";
import { Address } from "openzeppelin-contracts/contracts/utils/Address.sol";

import { ECDSA } from "solady/utils/ECDSA.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { ENTRYPOINT } from "webauthn-owner-plugin/../script/Factory.s.sol";
import { OwnersLib } from "webauthn-owner-plugin/OwnersLib.sol";
import { PublicKey, WebauthnOwnerPlugin } from "webauthn-owner-plugin/WebauthnOwnerPlugin.sol";

import { ExaAccountFactory } from "../src/ExaAccountFactory.sol";

import {
  ExaPlugin,
  FunctionId,
  IDebtManager,
  IFlashLoaner,
  IInstallmentsRouter,
  Parameters,
  ZeroAddress
} from "../src/ExaPlugin.sol";
import {
  BorrowAtMaturityData,
  CollectorSet,
  CrossRepayData,
  DelaySet,
  Expired,
  FixedPosition,
  FlashLoanerSet,
  IAuditor,
  IExaAccount,
  IMarket,
  IProposalManager,
  InvalidDelay,
  InvalidProposal,
  NoBalance,
  NoProposal,
  NonceTooLow,
  NotMarket,
  NotNext,
  PendingProposals,
  PluginAllowed,
  Proposal,
  ProposalManagerSet,
  ProposalNonceSet,
  ProposalType,
  Proposed,
  RepayData,
  Replay,
  RollDebtData,
  SwapData,
  SwapperSet,
  TargetAllowed,
  Timelocked,
  Unauthorized,
  ZeroAmount
} from "../src/IExaAccount.sol";
import { Collected, IssuerChecker, Refunded } from "../src/IssuerChecker.sol";

import { ProposalManager } from "../src/ProposalManager.sol";
import { Refunder } from "../src/Refunder.sol";

import { DeployIssuerChecker } from "../script/IssuerChecker.s.sol";
import { DeployProposalManager } from "../script/ProposalManager.s.sol";
import { DeployRefunder } from "../script/Refunder.s.sol";

import { DeployAccount } from "./mocks/Account.s.sol";

import { MockSwapper } from "./mocks/MockSwapper.sol";
import { DeployMocks } from "./mocks/Mocks.s.sol";
import { DeployProtocol } from "./mocks/Protocol.s.sol";

// solhint-disable-next-line max-states-count
contract ExaPluginTest is ForkTest {
  using FixedPointMathLib for uint256;
  using OwnersLib for address[];
  using Address for address;
  using ECDSA for bytes32;

  address internal owner;
  uint256 internal ownerKey;
  address internal keeper;
  uint256 internal keeperKey;
  address internal issuer;
  uint256 internal issuerKey;
  address[] internal owners;
  address payable internal collector;
  ExaAccount internal account;
  ExaPlugin internal exaPlugin;
  WebauthnOwnerPlugin internal ownerPlugin;
  IssuerChecker internal issuerChecker;
  ProposalManager internal proposalManager;
  bytes32 internal domainSeparator;
  Refunder internal refunder;

  Auditor internal auditor;
  IDebtManager internal debtManager;
  IMarket internal exaEXA;
  IMarket internal exaUSDC;
  IMarket internal exaWETH;
  MockERC20 internal exa;
  MockERC20 internal usdc;

  function setUp() external {
    collector = payable(makeAddr("collector"));
    (owner, ownerKey) = makeAddrAndKey("owner");
    owners = new address[](1);
    owners[0] = owner;
    (keeper, keeperKey) = makeAddrAndKey("keeper");
    (issuer, issuerKey) = makeAddrAndKey("issuer");

    new DeployAccount().run();
    DeployProtocol p = new DeployProtocol();
    p.run();
    auditor = p.auditor();
    exaEXA = IMarket(address(p.exaEXA()));
    exaUSDC = IMarket(address(p.exaUSDC()));
    exaWETH = IMarket(address(p.exaWETH()));
    exa = p.exa();
    usdc = p.usdc();

    DeployIssuerChecker ic = new DeployIssuerChecker();
    set("issuer", issuer);
    ic.run();
    unset("issuer");
    issuerChecker = ic.issuerChecker();

    DeployMocks m = new DeployMocks();
    set("Auditor", address(auditor));
    set("USDC", address(usdc));
    m.run();
    unset("Auditor");
    unset("USDC");

    DeployRefunder r = new DeployRefunder();
    set("MarketUSDC", address(exaUSDC));
    set("IssuerChecker", address(issuerChecker));
    set("keeper", keeper);
    r.run();
    unset("MarketUSDC");
    unset("IssuerChecker");
    unset("keeper");
    refunder = r.refunder();

    DeployProposalManager pm = new DeployProposalManager();
    set("admin", address(this));
    set("Auditor", address(auditor));
    set("DebtManager", address(p.debtManager()));
    set("InstallmentsRouter", address(p.installmentsRouter()));
    set("swapper", address(m.swapper()));
    set("collector", address(collector));
    set("esEXA", address(0x666));
    set("RewardsController", address(0x666));
    pm.run();
    unset("admin");
    unset("Auditor");
    unset("DebtManager");
    unset("InstallmentsRouter");
    unset("swapper");
    unset("collector");
    unset("esEXA");
    unset("RewardsController");
    proposalManager = pm.proposalManager();

    debtManager = IDebtManager(address(p.debtManager()));

    exaPlugin = new ExaPlugin(
      Parameters({
        owner: address(this),
        auditor: IAuditor(address(auditor)),
        exaUSDC: exaUSDC,
        exaWETH: exaWETH,
        flashLoaner: p.balancer(),
        debtManager: debtManager,
        installmentsRouter: IInstallmentsRouter(address(p.installmentsRouter())),
        issuerChecker: issuerChecker,
        proposalManager: IProposalManager(address(proposalManager)),
        collector: collector,
        swapper: address(m.swapper()),
        firstKeeper: keeper
      })
    );
    proposalManager.grantRole(proposalManager.PROPOSER_ROLE(), address(exaPlugin));

    ownerPlugin = new WebauthnOwnerPlugin();
    ExaAccountFactory factory = new ExaAccountFactory(
      address(this), ownerPlugin, exaPlugin, address(new UpgradeableModularAccount(ENTRYPOINT)), ENTRYPOINT
    );

    account = ExaAccount(payable(factory.createAccount(0, owners.toPublicKeys())));
    vm.deal(address(account), 10_000 ether);
    vm.label(address(account), "account");

    exa.mint(address(account), 10_000e18);
    usdc.mint(address(account), 100_000e6);

    address bob = address(0xb0b);
    vm.startPrank(bob);
    usdc.mint(bob, 10_000e6);
    usdc.approve(address(exaUSDC), 10_000e6);
    exaUSDC.deposit(10_000e6, bob);

    domainSeparator = issuerChecker.DOMAIN_SEPARATOR();

    vm.stopPrank();
  }

  // solhint-disable func-name-mixedcase

  // self runtime validation

  function test_swap_swaps() external {
    uint256 prevUSDC = usdc.balanceOf(address(account));
    uint256 prevEXA = exa.balanceOf(address(account));

    uint256 maxAmountIn = 111e18;
    uint256 amountOut = 110e6;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountOut, (address(exaEXA.asset()), maxAmountIn, address(usdc), amountOut, address(account))
    );
    vm.startPrank(address(account));
    account.swap(IERC20(exaEXA.asset()), IERC20(address(usdc)), maxAmountIn, amountOut, route);

    assertEq(usdc.balanceOf(address(account)), prevUSDC + amountOut);
    assertGe(exa.balanceOf(address(account)), prevEXA - maxAmountIn);
  }

  function testFork_swap_swaps() external {
    _setUpForkEnv();
    uint256 amount = 0.0004e8;
    IERC20 wbtc = IERC20(protocol("WBTC"));
    deal(address(wbtc), address(account), amount);
    proposalManager.allowTarget(address(wbtc), true);

    bytes memory route = bytes.concat(
      hex"4666fc80b7c64668375a12ff485d0a88dee3ac5d82d77587a6be542b9233c5eb13830c4c00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000",
      abi.encodePacked(address(account)),
      hex"00000000000000000000000000000000000000000000000000000000018f7705000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000034578610000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002a30783030303030303030303030303030303030303030303030303030303030303030303030303030303000000000000000000000000000000000000000000000000000000000000000000000111111125421ca6dc452d289314280a0f8842a65000000000000000000000000111111125421ca6dc452d289314280a0f8842a6500000000000000000000000068f180fcce6836688e9084f035309e29bf0a20950000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff850000000000000000000000000000000000000000000000000000000000009c4000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000004e807ed2379000000000000000000000000b63aae6c353636d66df13b89ba4425cfe13d10ba00000000000000000000000068f180fcce6836688e9084f035309e29bf0a20950000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85000000000000000000000000b63aae6c353636d66df13b89ba4425cfe13d10ba0000000000000000000000001231deb6f5749ef6ce6943a275a1d3e7486f4eae0000000000000000000000000000000000000000000000000000000000009c4000000000000000000000000000000000000000000000000000000000018f770400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000039600000000000000000000000000000000000000000000000000000000037800a007e5c0d20000000000000000000000000000000000000000000000000003540000f051204c4af8dbc524681930a27b2f1af5bcc8062e6fb768f180fcce6836688e9084f035309e29bf0a209500447dc2038200000000000000000000000068f180fcce6836688e9084f035309e29bf0a209500000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000002495763e3d93b6000000000000000000000000b63aae6c353636d66df13b89ba4425cfe13d10ba00000000000000000000000042f527f50f16a103b6ccab48bccca214500c102100a0c9e75c480000000000000013130c0000000000000000000000000000000000000000000002360001d300006302a000000000000000000000000000000000000000000000000000000000005f6305ee63c1e580c1738d90e2e26c35784a0d3e3d8a9f795074bca44200000000000000000000000000000000000006111111125421ca6dc452d289314280a0f8842a655106a062ae8a9c5e11aaa026fc2670b0d65ccc8b285842000000000000000000000000000000000000060004cac88ea9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000009708bd00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000111111125421ca6dc452d289314280a0f8842a6500000000000000000000000000000000000000000000000000000000671fb839000000000000000000000000000000000000000000000000000000000000000100000000000000000000000042000000000000000000000000000000000000060000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff850000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f1046053aa5682b4f9a81b5481394da16be5ff5a02a0000000000000000000000000000000000000000000000000000000000097095eee63c1e580d4cb5566b5c16ef2f4a08b1438052013171212a24200000000000000000000000000000000000006111111125421ca6dc452d289314280a0f8842a65000000000000000000002a94d114000000000000000000000000000000000000000000000000"
    );

    uint256 minAmount = 26_310_887;
    vm.startPrank(address(account));
    account.swap(wbtc, IERC20(address(usdc)), amount, minAmount, route);
    assertGe(usdc.balanceOf(address(account)), minAmount, "usdc dust");
  }

  function testFork_claimAndVestEscrowedEXA_claimsAndVests() external {
    _setUpForkEnv();

    IEscrowedEXA esEXA = IEscrowedEXA(protocol("esEXA"));
    IRewardsController rewardsController = IRewardsController(protocol("RewardsController"));
    uint256 unclaimedRewards = rewardsController.allClaimable(address(account), esEXA);

    exa = MockERC20(protocol("EXA"));
    proposalManager.allowTarget(address(rewardsController), true);
    proposalManager.allowTarget(address(exa), true);
    proposalManager.allowTarget(address(esEXA), true);

    assertEq(esEXA.balanceOf(address(account)), 0);

    vm.prank(address(account));
    account.execute(address(rewardsController), 0, abi.encodeCall(IRewardsController.claimAll, (address(account))));

    uint256 balance = esEXA.balanceOf(address(account));
    assertEq(balance, unclaimedRewards);
    assertEq(rewardsController.allClaimable(address(account), esEXA), 0);

    deal(address(exa), address(account), 1000e18);
    uint256 exaBalance = exa.balanceOf(address(account));

    vm.startPrank(address(account));
    account.execute(address(exa), 0, abi.encodeCall(IERC20.approve, (address(esEXA), type(uint256).max)));

    uint256[] memory streams = new uint256[](1);
    streams[0] = abi.decode(
      account.execute(
        address(esEXA),
        0,
        abi.encodeCall(IEscrowedEXA.vest, (uint128(balance), address(account), type(uint256).max, type(uint256).max))
      ),
      (uint256)
    );

    assertEq(esEXA.balanceOf(address(account)), 0);

    skip(esEXA.vestingPeriod());

    account.execute(address(esEXA), 0, abi.encodeCall(IEscrowedEXA.withdrawMax, (streams)));

    assertEq(exa.balanceOf(address(account)), exaBalance + balance);
  }

  function testFork_stakeEXA_stakes() external {
    _setUpForkEnv();
    IStakedEXA stEXA = IStakedEXA(protocol("stEXA"));
    exa = MockERC20(protocol("EXA"));
    deal(address(exa), address(account), 100e18);
    proposalManager.allowTarget(address(stEXA), true);
    proposalManager.allowTarget(address(exa), true);

    vm.startPrank(address(account));
    account.execute(address(exa), 0, abi.encodeCall(IERC20.approve, (address(stEXA), 100e18)));
    account.execute(address(stEXA), 0, abi.encodeCall(IERC4626.deposit, (100e18, address(account))));

    assertEq(stEXA.balanceOf(address(account)), 100e18);
    assertEq(exa.balanceOf(address(account)), 0);

    skip(stEXA.refTime());
    uint256 balance = exaUSDC.balanceOf(address(account));
    account.execute(address(stEXA), 0, abi.encodeCall(IStakedEXA.claim, (IERC20(address(exaUSDC)))));
    assertGt(exaUSDC.balanceOf(address(account)), balance);
  }

  function test_swap_reverts_withDisagreement() external {
    uint256 prevUSDC = usdc.balanceOf(address(account));
    uint256 prevEXA = exa.balanceOf(address(account));

    uint256 amountIn = 111e18;
    uint256 amountOut = 110e6;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountOut, (address(exaEXA.asset()), amountIn, address(usdc), amountOut, address(account))
    );
    vm.startPrank(address(account));
    vm.expectRevert(Disagreement.selector);
    account.swap(IERC20(address(exa)), IERC20(address(usdc)), amountIn, amountOut * 2, route);

    assertEq(usdc.balanceOf(address(account)), prevUSDC);
    assertEq(exa.balanceOf(address(account)), prevEXA);
  }

  function test_swap_reverts_whenAssetInIsMarket() external {
    vm.startPrank(keeper);

    account.poke(exaEXA);

    uint256 maxAmountIn = 111e18;
    uint256 amountOut = 110e6;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountOut, (address(exaEXA), maxAmountIn, address(usdc), amountOut, address(account))
    );
    vm.startPrank(address(account));
    vm.expectRevert(Unauthorized.selector);
    account.swap(IERC20(address(exaEXA)), IERC20(address(usdc)), maxAmountIn, amountOut, route);
  }

  function test_swap_reverts_whenCallerIsNotSelf() external {
    vm.startPrank(keeper);
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.RuntimeValidationFunctionReverted.selector,
        exaPlugin,
        FunctionId.RUNTIME_VALIDATION_SELF,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.swap(IERC20(address(exaEXA)), IERC20(address(usdc)), 1, 1, "");
  }

  // keeper or self runtime validation
  function test_propose_emitsProposed() external {
    uint256 amount = 1;
    address receiver = address(0x420);

    vm.startPrank(owner);

    bytes memory data = abi.encode(receiver);

    vm.expectEmit(true, true, true, true, address(proposalManager));
    emit Proposed(
      address(account), 0, exaEXA, ProposalType.WITHDRAW, amount, data, block.timestamp + proposalManager.delay()
    );
    account.execute(
      address(account), 0, abi.encodeCall(IExaAccount.propose, (exaEXA, amount, ProposalType.WITHDRAW, data))
    );
  }

  function test_proposeSwap_emitsSwapProposed() external {
    uint256 amount = 1;
    bytes memory route = bytes("route");
    bytes memory data = abi.encode(SwapData({ assetOut: IERC20(address(usdc)), minAmountOut: 1, route: route }));

    vm.startPrank(owner);
    vm.expectEmit(true, true, true, true, address(proposalManager));
    emit Proposed(
      address(account), 0, exaEXA, ProposalType.SWAP, amount, data, block.timestamp + proposalManager.delay()
    );
    account.execute(address(account), 0, abi.encodeCall(IExaAccount.propose, (exaEXA, amount, ProposalType.SWAP, data)));
  }

  function test_repay_repaysX() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);
    uint256 maturity = FixedLib.INTERVAL;
    account.collectCredit(maturity, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));

    FixedPosition memory position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    assertEq(position.principal, 100e6);
    uint256 positionAssets = position.principal + position.fee;

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(
        IExaAccount.propose,
        (
          exaUSDC,
          positionAssets + 1, // max repay
          ProposalType.REPAY_AT_MATURITY,
          abi.encode(RepayData({ maturity: maturity, positionAssets: positionAssets }))
        )
      )
    );

    skip(proposalManager.delay());

    vm.startPrank(address(account));
    account.executeProposal(proposalManager.nonces(address(account)));

    assertEq(usdc.balanceOf(address(exaPlugin)), 0, "usdc dust");
    position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    assertEq(position.principal, 0);
  }

  function test_repay_partiallyRepays() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);
    uint256 maturity = FixedLib.INTERVAL;
    account.collectCredit(maturity, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));

    FixedPosition memory position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    assertEq(position.principal, 100e6);
    uint256 positionAssets = position.principal + position.fee;

    vm.startPrank(address(account));
    account.execute(
      address(account),
      0,
      abi.encodeCall(
        IExaAccount.propose,
        (
          exaUSDC,
          positionAssets / 2,
          ProposalType.REPAY_AT_MATURITY,
          abi.encode(RepayData({ maturity: maturity, positionAssets: positionAssets / 2 }))
        )
      )
    );

    skip(proposalManager.delay());

    account.executeProposal(proposalManager.nonces(address(account)));
    assertEq(usdc.balanceOf(address(exaPlugin)), 0, "usdc dust");
    position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    assertEq(position.principal, 50e6);
    assertEq(position.principal + position.fee, positionAssets / 2);
  }

  function test_repay_repays_whenKeeper() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);
    uint256 maturity = FixedLib.INTERVAL;
    account.collectCredit(maturity, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));

    FixedPosition memory position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    assertEq(position.principal, 100e6);
    uint256 positionAssets = position.principal + position.fee;

    vm.startPrank(address(account));
    account.propose(
      exaUSDC,
      positionAssets + 1,
      ProposalType.REPAY_AT_MATURITY,
      abi.encode(RepayData({ maturity: maturity, positionAssets: positionAssets }))
    );

    skip(proposalManager.delay());

    account.executeProposal(proposalManager.nonces(address(account)));
    assertEq(usdc.balanceOf(address(exaPlugin)), 0, "usdc dust");
    position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    assertEq(position.principal, 0);
    assertEq(position.fee, 0);
  }

  function test_repay_partiallyRepays_whenKeeper() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);
    uint256 maturity = FixedLib.INTERVAL;
    account.collectCredit(maturity, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));

    FixedPosition memory position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    assertEq(position.principal, 100e6);
    uint256 positionAssets = position.principal + position.fee;

    account.proposeRepay(
      exaUSDC,
      positionAssets / 2,
      ProposalType.REPAY_AT_MATURITY,
      abi.encode(RepayData({ maturity: maturity, positionAssets: positionAssets / 2 }))
    );
    skip(proposalManager.delay());
    account.executeProposal(proposalManager.nonces(address(account)));

    assertEq(usdc.balanceOf(address(exaPlugin)), 0, "usdc dust");
    position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    assertEq(position.principal, 50e6);
    assertEq(position.principal + position.fee, positionAssets / 2);
  }

  function test_repay_consumesProposal() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);
    uint256 maturity = FixedLib.INTERVAL;
    account.collectCredit(maturity, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));

    uint256 positionAssets = exaUSDC.fixedBorrowPositions(maturity, address(account)).principal
      + exaUSDC.fixedBorrowPositions(maturity, address(account)).fee;

    account.proposeRepay(
      exaUSDC,
      positionAssets,
      ProposalType.REPAY_AT_MATURITY,
      abi.encode(RepayData({ maturity: maturity, positionAssets: positionAssets }))
    );

    skip(proposalManager.delay());

    uint256 nonce = proposalManager.nonces(address(account));
    uint256 queueNonce = proposalManager.queueNonces(address(account));
    assertEq(queueNonce, nonce + 1);

    vm.startPrank(address(account));
    account.executeProposal(proposalManager.nonces(address(account)));

    assertEq(usdc.balanceOf(address(exaPlugin)), 0, "usdc dust");
    uint256 newPositionAssets = exaUSDC.fixedBorrowPositions(maturity, address(account)).principal
      + exaUSDC.fixedBorrowPositions(maturity, address(account)).fee;
    assertEq(newPositionAssets, 0);

    assertEq(proposalManager.nonces(address(account)), nonce + 1, "nonce didn't increase");
    assertEq(proposalManager.queueNonces(address(account)), queueNonce, "queue nonce didn't stay the same");
  }

  function test_crossRepay_consumesProposal() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    uint256 maturity = FixedLib.INTERVAL;
    account.collectCredit(maturity, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));

    uint256 amountIn = 111e18;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountOut, (address(exaEXA.asset()), amountIn, address(usdc), 110e6, address(account))
    );

    vm.startPrank(address(account));
    account.propose(
      exaEXA,
      amountIn,
      ProposalType.CROSS_REPAY_AT_MATURITY,
      abi.encode(
        CrossRepayData({ maturity: maturity, positionAssets: 110e6, marketOut: exaUSDC, maxRepay: 110e6, route: route })
      )
    );

    skip(proposalManager.delay());

    uint256 nonce = proposalManager.nonces(address(account));
    uint256 queueNonce = proposalManager.queueNonces(address(account));
    assertEq(queueNonce, nonce + 1);

    account.executeProposal(proposalManager.nonces(address(account)));

    assertEq(proposalManager.nonces(address(account)), nonce + 1, "nonce didn't increase");
    assertEq(proposalManager.queueNonces(address(account)), queueNonce, "queue nonce didn't stay the same");
  }

  function test_withdrawETH_consumesProposal() external {
    vm.startPrank(keeper);
    account.pokeETH();

    vm.startPrank(address(account));
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaWETH, 1 ether, ProposalType.WITHDRAW, abi.encode(address(0x1))))
    );

    uint256 nonce = proposalManager.nonces(address(account));
    uint256 queueNonce = proposalManager.queueNonces(address(account));
    assertEq(queueNonce, nonce + 1);

    skip(proposalManager.delay());
    account.executeProposal(proposalManager.nonces(address(account)));

    uint256 newNonce = proposalManager.nonces(address(account));
    assertEq(newNonce, nonce + 1, "nonce not increased as expected");
    assertEq(queueNonce, newNonce);
  }

  function test_withdrawETH_asOwner_consumesProposal() external {
    vm.startPrank(keeper);
    account.pokeETH();

    vm.startPrank(address(account));
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaWETH, 1 ether, ProposalType.WITHDRAW, abi.encode(address(0x1))))
    );

    uint256 nonce = proposalManager.nonces(address(account));
    uint256 queueNonce = proposalManager.queueNonces(address(account));
    assertEq(queueNonce, nonce + 1);

    skip(proposalManager.delay());

    account.executeProposal(proposalManager.nonces(address(account)));

    uint256 newNonce = proposalManager.nonces(address(account));
    assertEq(newNonce, nonce + 1, "nonce not increased as expected");
    assertEq(queueNonce, newNonce);
  }

  function test_borrowAtMaturity_borrows() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    uint256 maturity = FixedLib.INTERVAL;
    vm.startPrank(address(account));
    account.propose(
      exaUSDC,
      100e6,
      ProposalType.BORROW_AT_MATURITY,
      abi.encode(BorrowAtMaturityData({ maturity: maturity, maxAssets: 110e6, receiver: address(account) }))
    );

    uint256 usdcBalance = usdc.balanceOf(address(account));
    skip(proposalManager.delay());
    account.executeProposal(proposalManager.nonces(address(account)));

    assertEq(usdc.balanceOf(address(account)), usdcBalance + 100e6, "borrowed amount not received");
    assertEq(exaUSDC.fixedBorrowPositions(maturity, address(account)).principal, 100e6);
    assertLe(exaUSDC.fixedBorrowPositions(maturity, address(account)).fee, 10e6);
  }

  function test_borrowAtMaturity_borrowsEXA() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    uint256 maturity = FixedLib.INTERVAL;
    vm.startPrank(address(account));
    account.propose(
      exaEXA,
      100e18,
      ProposalType.BORROW_AT_MATURITY,
      abi.encode(BorrowAtMaturityData({ maturity: maturity, maxAssets: 110e18, receiver: address(account) }))
    );

    uint256 exaBalance = exa.balanceOf(address(account));
    skip(proposalManager.delay());
    account.executeProposal(proposalManager.nonces(address(account)));

    assertEq(exa.balanceOf(address(account)), exaBalance + 100e18, "borrowed amount not received");
    assertEq(exaEXA.fixedBorrowPositions(maturity, address(account)).principal, 100e18, "principal doesn't match");
    assertLe(exaEXA.fixedBorrowPositions(maturity, address(account)).fee, 10e18, "fee is higher than limit");
  }

  function test_crossRepay_repays() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    uint256 maturity = FixedLib.INTERVAL;
    account.collectCredit(maturity, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));

    uint256 prevCollateral = exaEXA.balanceOf(address(account));
    FixedPosition memory position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    assertGt(position.principal, 0);

    uint256 amountIn = 111e18;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountOut, (address(exaEXA.asset()), amountIn, address(usdc), 110e6, address(account))
    );
    vm.startPrank(address(account));

    account.propose(
      exaEXA,
      amountIn,
      ProposalType.CROSS_REPAY_AT_MATURITY,
      abi.encode(
        CrossRepayData({ maturity: maturity, positionAssets: 110e6, marketOut: exaUSDC, maxRepay: 110e6, route: route })
      )
    );

    skip(proposalManager.delay());
    account.executeProposal(proposalManager.nonces(address(account)));

    assertEq(usdc.balanceOf(address(exaPlugin)), 0, "usdc dust");
    assertGt(exaUSDC.balanceOf(address(account)), 0, "left usdc not deposited");
    assertGt(prevCollateral, exaEXA.balanceOf(address(account)), "collateral didn't decrease");
    assertEq(exaUSDC.fixedBorrowPositions(maturity, address(account)).principal, 0, "debt not fully repaid");
    assertEq(exaUSDC.fixedBorrowPositions(maturity, address(account)).fee, 0, "debt not fully repaid");
  }

  function test_crossRepay_repaysEXA() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    account.poke(exaUSDC);
    uint256 maturity = FixedLib.INTERVAL;

    vm.startPrank(address(account));
    account.propose(
      exaEXA,
      100e18,
      ProposalType.BORROW_AT_MATURITY,
      abi.encode(BorrowAtMaturityData({ maturity: maturity, maxAssets: 110e18, receiver: address(account) }))
    );

    uint256 exaBalance = exa.balanceOf(address(account));
    skip(proposalManager.delay());
    account.executeProposal(proposalManager.nonces(address(account)));

    assertEq(exaEXA.fixedBorrowPositions(maturity, address(account)).principal, 100e18, "wrong principal");
    assertGt(exaEXA.fixedBorrowPositions(maturity, address(account)).fee, 0, "no fees");
    assertEq(exa.balanceOf(address(account)), exaBalance + 100e18, "borrowed not received");

    uint256 amountIn = 560e6;
    uint256 exaUSDCBalance = exaUSDC.balanceOf(address(account));
    uint256 positionAssets = exaEXA.fixedBorrowPositions(maturity, address(account)).principal
      + exaEXA.fixedBorrowPositions(maturity, address(account)).fee;

    account.propose(
      exaUSDC,
      amountIn,
      ProposalType.CROSS_REPAY_AT_MATURITY,
      abi.encode(
        CrossRepayData({
          maturity: maturity,
          positionAssets: positionAssets,
          marketOut: exaEXA,
          maxRepay: positionAssets.mulWad(1.1e18),
          route: abi.encodeCall(
            MockSwapper.swapExactAmountOut,
            (address(usdc), amountIn, address(exaEXA.asset()), positionAssets.mulWad(1.1e18), address(account))
          )
        })
      )
    );

    skip(proposalManager.delay());
    account.executeProposal(proposalManager.nonces(address(account)));

    assertEq(exaEXA.fixedBorrowPositions(maturity, address(account)).principal, 0, "principal != 0");
    assertEq(exaEXA.fixedBorrowPositions(maturity, address(account)).fee, 0, "fee != 0");
    assertApproxEqAbs(exaUSDCBalance, exaUSDC.balanceOf(address(account)) + amountIn, 10e6);
  }

  function testFork_crossRepay_repays() external {
    _setUpForkEnv();
    uint256 amount = 0.0004e8;
    IMarket exaWBTC = IMarket(protocol("MarketWBTC"));
    deal(address(exaWBTC), address(account), amount);

    uint256 maturity = block.timestamp + 2 * FixedLib.INTERVAL - (block.timestamp % FixedLib.INTERVAL);

    bytes memory route = bytes.concat(
      hex"4666fc80b7c64668375a12ff485d0a88dee3ac5d82d77587a6be542b9233c5eb13830c4c00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000",
      abi.encodePacked(address(account)),
      hex"00000000000000000000000000000000000000000000000000000000018f7705000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000034578610000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002a30783030303030303030303030303030303030303030303030303030303030303030303030303030303000000000000000000000000000000000000000000000000000000000000000000000111111125421ca6dc452d289314280a0f8842a65000000000000000000000000111111125421ca6dc452d289314280a0f8842a6500000000000000000000000068f180fcce6836688e9084f035309e29bf0a20950000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff850000000000000000000000000000000000000000000000000000000000009c4000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000004e807ed2379000000000000000000000000b63aae6c353636d66df13b89ba4425cfe13d10ba00000000000000000000000068f180fcce6836688e9084f035309e29bf0a20950000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85000000000000000000000000b63aae6c353636d66df13b89ba4425cfe13d10ba0000000000000000000000001231deb6f5749ef6ce6943a275a1d3e7486f4eae0000000000000000000000000000000000000000000000000000000000009c4000000000000000000000000000000000000000000000000000000000018f770400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000039600000000000000000000000000000000000000000000000000000000037800a007e5c0d20000000000000000000000000000000000000000000000000003540000f051204c4af8dbc524681930a27b2f1af5bcc8062e6fb768f180fcce6836688e9084f035309e29bf0a209500447dc2038200000000000000000000000068f180fcce6836688e9084f035309e29bf0a209500000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000002495763e3d93b6000000000000000000000000b63aae6c353636d66df13b89ba4425cfe13d10ba00000000000000000000000042f527f50f16a103b6ccab48bccca214500c102100a0c9e75c480000000000000013130c0000000000000000000000000000000000000000000002360001d300006302a000000000000000000000000000000000000000000000000000000000005f6305ee63c1e580c1738d90e2e26c35784a0d3e3d8a9f795074bca44200000000000000000000000000000000000006111111125421ca6dc452d289314280a0f8842a655106a062ae8a9c5e11aaa026fc2670b0d65ccc8b285842000000000000000000000000000000000000060004cac88ea9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000009708bd00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000111111125421ca6dc452d289314280a0f8842a6500000000000000000000000000000000000000000000000000000000671fb839000000000000000000000000000000000000000000000000000000000000000100000000000000000000000042000000000000000000000000000000000000060000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff850000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f1046053aa5682b4f9a81b5481394da16be5ff5a02a0000000000000000000000000000000000000000000000000000000000097095eee63c1e580d4cb5566b5c16ef2f4a08b1438052013171212a24200000000000000000000000000000000000006111111125421ca6dc452d289314280a0f8842a65000000000000000000002a94d114000000000000000000000000000000000000000000000000"
    );
    uint256 prevCollateral = exaWBTC.balanceOf(address(account));
    FixedPosition memory position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    uint256 prevPrincipal = position.principal;
    assertGt(prevPrincipal, 0);

    vm.startPrank(address(account));
    account.propose(
      exaWBTC,
      amount,
      ProposalType.CROSS_REPAY_AT_MATURITY,
      abi.encode(
        CrossRepayData({ maturity: maturity, positionAssets: 21e6, marketOut: exaUSDC, maxRepay: 25e6, route: route })
      )
    );

    skip(proposalManager.delay());
    account.executeProposal(proposalManager.nonces(address(account)));

    assertEq(usdc.balanceOf(address(exaPlugin)), 0, "usdc dust");
    assertGt(prevCollateral, exaWBTC.balanceOf(address(account)), "collateral didn't decrease");

    position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    assertGt(prevPrincipal, position.principal, "fixed debt didn't decrease");
  }

  function test_crossRepay_repays_whenKeeper() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    uint256 maturity = FixedLib.INTERVAL;
    account.collectCredit(maturity, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));

    uint256 prevCollateral = exaEXA.balanceOf(address(account));
    FixedPosition memory position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    uint256 prevPrincipal = position.principal;
    assertGt(prevPrincipal, 0);

    uint256 amountIn = 111e18;
    account.proposeRepay(
      exaEXA,
      amountIn,
      ProposalType.CROSS_REPAY_AT_MATURITY,
      abi.encode(
        CrossRepayData({
          maturity: maturity,
          positionAssets: 110e6,
          marketOut: exaUSDC,
          maxRepay: 110e6,
          route: abi.encodeCall(
            MockSwapper.swapExactAmountOut, (address(exaEXA.asset()), amountIn, address(usdc), 110e6, address(account))
          )
        })
      )
    );

    skip(proposalManager.delay());
    account.executeProposal(proposalManager.nonces(address(account)));

    assertEq(usdc.balanceOf(address(exaPlugin)), 0, "usdc dust");
    assertGt(exaUSDC.balanceOf(address(account)), 0, "left usdc not deposited");
    assertGt(prevCollateral, exaEXA.balanceOf(address(account)), "collateral didn't decrease");
    assertEq(exaUSDC.fixedBorrowPositions(maturity, address(account)).principal, 0, "debt not fully repaid");
  }

  function test_crossRepay_reverts_whenNotKeeper() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    uint256 maturity = FixedLib.INTERVAL;
    account.collectCredit(maturity, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));

    FixedPosition memory position = exaUSDC.fixedBorrowPositions(maturity, address(account));
    uint256 prevPrincipal = position.principal;
    assertGt(prevPrincipal, 0);

    uint256 amountIn = 111e18;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountOut, (address(exaEXA.asset()), amountIn, address(usdc), 110e6, address(account))
    );
    vm.startPrank(address(account));
    account.propose(
      exaEXA,
      amountIn,
      ProposalType.CROSS_REPAY_AT_MATURITY,
      abi.encode(
        CrossRepayData({ maturity: maturity, positionAssets: 110e6, marketOut: exaUSDC, maxRepay: 110e6, route: route })
      )
    );

    skip(proposalManager.delay());
    vm.startPrank(vm.addr(0x1));
    uint256 nonce = proposalManager.nonces(address(account));
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.RuntimeValidationFunctionReverted.selector,
        exaPlugin,
        FunctionId.RUNTIME_VALIDATION_KEEPER_OR_SELF,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.executeProposal(nonce);
  }

  function test_crossRepay_reverts_whenDisagreement() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    uint256 maturity = FixedLib.INTERVAL;
    account.collectCredit(maturity, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));

    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountOut, (address(exaEXA.asset()), 60e18, address(usdc), 10e6, address(account))
    );

    vm.startPrank(address(account));
    account.propose(
      exaEXA,
      60e18,
      ProposalType.CROSS_REPAY_AT_MATURITY,
      abi.encode(
        CrossRepayData({ maturity: maturity, positionAssets: 110e6, marketOut: exaUSDC, maxRepay: 110e6, route: route })
      )
    );

    skip(proposalManager.delay());
    uint256 nonce = proposalManager.nonces(address(account));
    vm.expectRevert(Disagreement.selector);
    account.executeProposal(nonce);
  }

  function test_propose_reverts_whenNotMarket() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    uint256 maturity = FixedLib.INTERVAL;
    account.collectCredit(maturity, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));

    vm.expectRevert(abi.encodeWithSelector(NotMarket.selector));
    vm.startPrank(address(account));
    account.propose(
      IMarket(address(0x1234)),
      100e18,
      ProposalType.CROSS_REPAY_AT_MATURITY,
      abi.encode(
        CrossRepayData({
          maturity: maturity,
          positionAssets: 110e6,
          marketOut: exaUSDC,
          maxRepay: 110e6,
          route: bytes("")
        })
      )
    );
  }

  function test_rollDebt_rollsX() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);
    uint256 assets = 100e6;
    uint256 maxAssets = 110e6;
    account.collectCredit(FixedLib.INTERVAL, assets, block.timestamp, _issuerOp(assets, block.timestamp));

    vm.startPrank(address(account));
    account.propose(
      exaUSDC,
      maxAssets,
      ProposalType.ROLL_DEBT,
      abi.encode(
        RollDebtData({
          repayMaturity: FixedLib.INTERVAL,
          borrowMaturity: FixedLib.INTERVAL * 2,
          maxRepayAssets: maxAssets,
          percentage: 1e18
        })
      )
    );
    skip(proposalManager.delay());
    account.executeProposal(proposalManager.nonces(address(account)));

    FixedPosition memory position = exaUSDC.fixedBorrowPositions(FixedLib.INTERVAL, address(account));
    assertEq(position.principal, 0);
    assertEq(position.fee, 0);
    position = exaUSDC.fixedBorrowPositions(FixedLib.INTERVAL * 2, address(account));
    assertGt(position.principal, assets);
    assertGt(position.fee, 0);
    assertLe(position.principal, maxAssets);
  }

  function test_rollDebt_rolls_asKeeper() external {
    vm.startPrank(keeper);

    account.poke(exaUSDC);
    uint256 assets = 100e6;
    uint256 maxAssets = 110e6;
    account.collectCredit(FixedLib.INTERVAL, assets, maxAssets, block.timestamp, _issuerOp(assets, block.timestamp));

    account.proposeRepay(
      exaUSDC,
      maxAssets,
      ProposalType.ROLL_DEBT,
      abi.encode(
        RollDebtData({
          repayMaturity: FixedLib.INTERVAL,
          borrowMaturity: FixedLib.INTERVAL * 2,
          maxRepayAssets: maxAssets,
          percentage: 1e18
        })
      )
    );
    skip(proposalManager.delay());

    account.executeProposal(proposalManager.nonces(address(account)));

    FixedPosition memory position = exaUSDC.fixedBorrowPositions(FixedLib.INTERVAL, address(account));
    assertEq(position.principal, 0);
    assertEq(position.fee, 0);
    position = exaUSDC.fixedBorrowPositions(FixedLib.INTERVAL * 2, address(account));
    assertGt(position.principal, assets);
    assertGt(position.fee, 0);
    assertLe(position.principal, maxAssets);
  }

  function test_marketWithdraw_transfersAsset_asOwner() external {
    uint256 amount = 100 ether;
    address receiver = address(0x420);
    vm.prank(keeper);
    account.poke(exaEXA);

    vm.prank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, amount, ProposalType.WITHDRAW, abi.encode(receiver)))
    );

    skip(proposalManager.delay());

    assertEq(exa.balanceOf(receiver), 0);
    vm.prank(owner);
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (amount, receiver, address(account))));
    assertEq(exa.balanceOf(receiver), amount, "receiver balance doesn't match");
  }

  function test_proposeWithdraw_reverts_whenKeeper() external {
    uint256 amount = 100 ether;
    address receiver = address(0x420);
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.RuntimeValidationFunctionReverted.selector,
        exaPlugin,
        FunctionId.RUNTIME_VALIDATION_SELF,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.propose(exaEXA, amount, ProposalType.WITHDRAW, abi.encode(receiver));
  }

  function test_withdraw_withdrawsProposed() external {
    uint256 amount = 100 ether;
    address receiver = address(0x420);
    vm.prank(keeper);
    account.poke(exaEXA);

    vm.startPrank(address(account));
    account.propose(exaEXA, amount, ProposalType.WITHDRAW, abi.encode(receiver));

    skip(proposalManager.delay());

    assertEq(exa.balanceOf(receiver), 0);
    account.executeProposal(proposalManager.nonces(address(account)));
    assertEq(exa.balanceOf(receiver), amount);
  }

  function test_withdraw_swapsProposed() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    account.poke(exaUSDC);

    uint256 amount = 100 ether;
    uint256 minAmountOut = 490e6;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountIn, (address(exaEXA.asset()), amount, address(usdc), minAmountOut, address(account))
    );
    vm.startPrank(address(account));
    account.execute(
      address(account),
      0,
      abi.encodeCall(
        IExaAccount.propose,
        (
          exaEXA,
          amount,
          ProposalType.SWAP,
          abi.encode(SwapData({ assetOut: IERC20(address(usdc)), minAmountOut: minAmountOut, route: route }))
        )
      )
    );

    skip(proposalManager.delay());

    assertEq(usdc.balanceOf(address(account)), 0);
    account.executeProposal(proposalManager.nonces(address(account)));
    assertGe(usdc.balanceOf(address(account)), minAmountOut, "usdc balance != min amount out");
  }

  function test_withdraw_transfersETH() external {
    uint256 amount = 100 ether;
    address receiver = address(0x420);
    vm.prank(keeper);
    account.pokeETH();

    vm.prank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaWETH, amount, ProposalType.WITHDRAW, abi.encode(receiver)))
    );

    skip(proposalManager.delay());

    assertEq(receiver.balance, 0);
    vm.startPrank(keeper);
    account.executeProposal(proposalManager.nonces(address(account)));
    assertEq(receiver.balance, amount);
  }

  function test_withdraw_swapsWETH() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);
    account.pokeETH();

    uint256 amount = 1 ether;
    uint256 minAmountOut = 2450e6;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountIn, (address(exaWETH.asset()), amount, address(usdc), minAmountOut, address(account))
    );
    uint256 nonce = proposalManager.nonces(address(account));
    vm.startPrank(address(account));
    account.execute(
      address(account),
      0,
      abi.encodeCall(
        IExaAccount.propose,
        (
          exaWETH,
          amount,
          ProposalType.SWAP,
          abi.encode(SwapData({ assetOut: IERC20(address(usdc)), minAmountOut: minAmountOut, route: route }))
        )
      )
    );

    skip(proposalManager.delay());

    assertEq(usdc.balanceOf(address(account)), 0);
    account.executeProposal(proposalManager.nonces(address(account)));
    assertGe(usdc.balanceOf(address(account)), minAmountOut);
    assertEq(proposalManager.nonces(address(account)), nonce + 1);
  }

  function test_withdraw_reverts_whenReceiverIsContractAndMarketNotWETH() external {
    uint256 amount = 100 ether;
    address receiver = address(0x420);
    vm.prank(keeper);
    account.poke(exaEXA);

    vm.prank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, amount, ProposalType.WITHDRAW, abi.encode(receiver)))
    );

    skip(proposalManager.delay());

    assertEq(exa.balanceOf(receiver), 0);
    vm.startPrank(owner);
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(NoProposal.selector)
      )
    );
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (amount, address(this), address(account))));
  }

  function test_withdraw_reverts_whenNoProposal() external {
    uint256 amount = 1;
    proposalManager.allowTarget(address(exaEXA), true);
    vm.prank(keeper);
    account.poke(exaEXA);

    vm.prank(owner);
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(NoProposal.selector)
      )
    );
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (amount, address(account), address(account))));
  }

  function test_withdraw_reverts_whenNoProposalKeeper() external {
    proposalManager.allowTarget(address(exaEXA), true);
    vm.startPrank(keeper);
    account.poke(exaEXA);
    uint256 nonce = proposalManager.nonces(address(account));
    vm.expectRevert(NoProposal.selector);
    account.executeProposal(nonce);
  }

  function test_withdraw_reverts_whenTimelocked() external {
    uint256 amount = 1;
    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, amount, ProposalType.WITHDRAW, abi.encode(address(account))))
    );

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(Timelocked.selector)
      )
    );
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (amount, address(account), address(account))));
  }

  function test_withdraw_reverts_whenTimelockedKeeper() external {
    uint256 amount = 1;
    vm.prank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, amount, ProposalType.WITHDRAW, abi.encode(address(account))))
    );

    uint256 nonce = proposalManager.nonces(address(account));
    vm.prank(keeper);
    vm.expectRevert(Timelocked.selector);
    account.executeProposal(nonce);
  }

  function test_withdraw_reverts_whenWrongAmount() external {
    uint256 amount = 1;
    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, amount, ProposalType.WITHDRAW, abi.encode(address(account))))
    );
    skip(proposalManager.delay());

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(NoProposal.selector)
      )
    );
    account.execute(
      address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (amount + 1, address(account), address(account)))
    );
  }

  function test_withdraw_reverts_whenWrongMarket() external {
    uint256 amount = 1;
    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaUSDC, amount, ProposalType.WITHDRAW, abi.encode(address(account))))
    );

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(NoProposal.selector)
      )
    );
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (amount, address(account), address(account))));
  }

  function test_withdraw_reverts_whenWrongReceiver() external {
    uint256 amount = 1;
    address receiver = address(0x420);
    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, amount, ProposalType.WITHDRAW, abi.encode(receiver)))
    );
    skip(proposalManager.delay());

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(NoProposal.selector)
      )
    );
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (amount, address(0x123), address(account))));
  }

  function test_withdraw_reverts_whenNotKeeper() external {
    vm.prank(keeper);
    account.poke(exaEXA);

    uint256 nonce = proposalManager.nonces(address(account));
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.RuntimeValidationFunctionReverted.selector,
        exaPlugin,
        FunctionId.RUNTIME_VALIDATION_KEEPER_OR_SELF,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.executeProposal(nonce);
  }

  function test_withdraw_reverts_whenTimelockedETH() external {
    address receiver = address(0x420);
    vm.prank(keeper);
    account.pokeETH();

    vm.prank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaWETH, 100 ether, ProposalType.WITHDRAW, abi.encode(receiver)))
    );

    skip(proposalManager.delay() - 1);

    assertEq(receiver.balance, 0);
    vm.startPrank(keeper);
    uint256 nonce = proposalManager.nonces(address(account));
    vm.expectRevert(Timelocked.selector);
    account.executeProposal(nonce);
    assertEq(receiver.balance, 0);
  }

  function test_withdraw_reverts_whenNoProposalAndReceiverIsProposer() external {
    proposalManager.allowTarget(address(exaEXA), true);
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.startPrank(owner);
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(Unauthorized.selector)
      )
    );
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (100, address(exaPlugin), address(account))));
  }

  function test_redeem_reverts_whenNoProposalAndReceiverIsProposer() external {
    proposalManager.allowTarget(address(exaEXA), true);
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.startPrank(owner);
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(Unauthorized.selector)
      )
    );
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.redeem, (100, address(exaPlugin), address(account))));
  }

  function test_redeem_withdraws() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    uint256 exaBalance = exaEXA.maxWithdraw(address(account));
    uint256 exaShares = exaEXA.balanceOf(address(account));

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, exaShares, ProposalType.REDEEM, abi.encode(address(0x420))))
    );
    skip(proposalManager.delay());
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.redeem, (exaShares, address(0x420), address(account))));

    assertEq(exaEXA.balanceOf(address(account)), 0);
    assertEq(exa.balanceOf(address(0x420)), exaBalance);
  }

  function test_redeem_withdraws_whenExecuteProposal() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    uint256 exaBalance = exaEXA.maxWithdraw(address(account));
    uint256 exaShares = exaEXA.balanceOf(address(account));

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, exaShares, ProposalType.REDEEM, abi.encode(address(account))))
    );
    skip(proposalManager.delay());
    account.execute(
      address(account), 0, abi.encodeCall(IExaAccount.executeProposal, (proposalManager.nonces(address(account))))
    );

    assertEq(exaEXA.balanceOf(address(account)), 0);
    assertEq(exa.balanceOf(address(account)), exaBalance);
  }

  function test_setProposalNonce_sets() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.startPrank(address(account));
    account.propose(exaEXA, 100e6, ProposalType.WITHDRAW, abi.encode(address(0x420)));
    skip(proposalManager.delay());

    account.setProposalNonce(1);

    uint256 nonce = proposalManager.nonces(address(account));
    vm.expectRevert(NoProposal.selector);
    account.executeProposal(nonce);

    account.propose(exaEXA, 100e6, ProposalType.WITHDRAW, abi.encode(address(0x420)));
    skip(proposalManager.delay());

    account.executeProposal(proposalManager.nonces(address(account)));
  }

  function test_setProposalNonce_emitsEvent() external {
    vm.startPrank(address(account));

    account.propose(exaEXA, 100e6, ProposalType.WITHDRAW, abi.encode(address(0x420)));
    uint256 nonce;
    Proposal memory proposal;
    (nonce, proposal) = proposalManager.nextProposal(address(account));
    assertEq(proposal.amount, 100e6);

    vm.expectEmit(true, true, true, true, address(proposalManager));
    emit ProposalNonceSet(address(account), nonce + 1, false);
    account.setProposalNonce(nonce + 1);

    nonce = proposalManager.nonces(address(account));
    vm.expectRevert(NoProposal.selector);
    proposalManager.nextProposal(address(account));
  }

  function test_redeem_reverts_whenProposalTypeIsWithdraw() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.startPrank(address(account));
    account.propose(exaEXA, 100e18, ProposalType.WITHDRAW, abi.encode(address(0x420)));
    skip(proposalManager.delay());

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(NoProposal.selector)
      )
    );
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.redeem, (100e18, address(0x420), address(account))));
  }

  function test_withdraw_reverts_whenProposalTypeIsRedeem() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.startPrank(address(account));
    account.propose(exaEXA, 100e18, ProposalType.REDEEM, abi.encode(address(0x420)));
    skip(proposalManager.delay());

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(NoProposal.selector)
      )
    );
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (100e18, address(0x420), address(account))));
  }

  function test_withdraw_reverts_whenProposalTypeIsBorrowAtMaturity() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.startPrank(address(account));
    account.propose(exaEXA, 100e18, ProposalType.BORROW_AT_MATURITY, abi.encode(address(0x420)));
    skip(proposalManager.delay());

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(NoProposal.selector)
      )
    );
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (100e18, address(0x420), address(account))));
  }

  function test_borrowAtMaturity_reverts_whenProposalTypeIsWithdraw() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.startPrank(address(account));
    account.propose(exaEXA, 100e18, ProposalType.WITHDRAW, abi.encode(address(0x420)));

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(Unauthorized.selector)
      )
    );
    account.execute(
      address(exaEXA),
      0,
      abi.encodeCall(IMarket.borrowAtMaturity, (FixedLib.INTERVAL, 100e18, 100e18, address(0x420), address(account)))
    );
  }

  function test_withdrawAtMaturity_withdraws() external {
    usdc.mint(address(this), 100e6);
    usdc.approve(address(exaUSDC), 100e6);
    uint256 positionAssets = exaUSDC.depositAtMaturity(FixedLib.INTERVAL, 100e6, 100e6, address(account));
    uint256 prevBalance = usdc.balanceOf(address(account));
    uint256 minAssets = 99e6;

    vm.startPrank(owner);
    account.execute(
      address(exaUSDC),
      0,
      abi.encodeCall(
        IMarket.withdrawAtMaturity, (FixedLib.INTERVAL, positionAssets, minAssets, address(account), address(account))
      )
    );

    assertGt(usdc.balanceOf(address(account)), prevBalance + minAssets);
  }

  function test_crossRepay_avoidsFrozenDeposit() external {
    vm.prank(keeper);
    account.poke(exaEXA);

    vm.startPrank(acct("admin"));
    exaEXA.setFrozen(true);

    vm.startPrank(keeper);

    uint256 prevCollateral = exaEXA.balanceOf(address(account));
    uint256 maxAmountIn = 111e18;
    uint256 minAmountOut = 110e6;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountOut, (exaEXA.asset(), maxAmountIn, address(usdc), minAmountOut, address(exaPlugin))
    );
    uint256 balance = usdc.balanceOf(exaPlugin.collector());
    (uint256 amountIn, uint256 amountOut) = account.collectCollateral(
      minAmountOut, exaEXA, maxAmountIn, block.timestamp, route, _issuerOp(minAmountOut, block.timestamp)
    );

    assertEq(usdc.balanceOf(exaPlugin.collector()), balance + minAmountOut, "collector's usdc != expected");
    assertEq(exaUSDC.balanceOf(address(account)), amountOut - minAmountOut, "account's usdc != expected");
    assertEq(exaEXA.balanceOf(address(account)), prevCollateral - maxAmountIn, "account's collateral != expected");

    assertEq(
      IERC20(exaEXA.asset()).balanceOf(address(account)),
      maxAmountIn - amountIn,
      "collateral asset didn't go to account"
    );
    assertEq(IERC20(exaEXA.asset()).balanceOf(address(exaPlugin)), 0, "collateral asset in plugin");
  }

  function test_crossRepay_avoidsZeroSharesDeposit() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.startPrank(address(account));
    exaEXA.borrow(5000e18, address(account), address(account));
    skip(365 days);
    exa.mint(address(account), 6000e18);
    exa.approve(address(exaEXA), type(uint256).max);
    exaEXA.repay(5000e18, address(account));

    vm.startPrank(keeper);

    uint256 maxAmountIn = 22_068_626_144_663_275_048;
    uint256 minAmountOut = 110e6;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountOut, (exaEXA.asset(), maxAmountIn, address(usdc), minAmountOut, address(exaPlugin))
    );

    uint256 prevEXA = exa.balanceOf(address(account));
    (uint256 amountIn,) = account.collectCollateral(
      minAmountOut, exaEXA, maxAmountIn, block.timestamp, route, _issuerOp(minAmountOut, block.timestamp)
    );

    uint256 unspent = maxAmountIn - amountIn;
    assertGt(unspent, 0, "unspent == 0");
    assertEq(exaEXA.previewDeposit(unspent), 0, "previewDeposit of unspent != 0");
    assertEq(prevEXA + unspent, exa.balanceOf(address(account)), "unspent not transferred to account");
  }

  // keeper runtime validation
  function test_collectCredit_collects() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    assertEq(usdc.balanceOf(collector), 0);

    account.collectCredit(FixedLib.INTERVAL, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));
    assertEq(usdc.balanceOf(collector), 100e6);
  }

  function test_collectCredit_collects_withPrevIssuerSignature() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    assertEq(usdc.balanceOf(collector), 0);

    bytes memory prevIssuerSignature = _issuerOp(100e6, block.timestamp);

    vm.startPrank(acct("admin"));
    issuerChecker.setIssuer(address(0x420));

    vm.startPrank(keeper);
    account.collectCredit(FixedLib.INTERVAL, 100e6, block.timestamp, prevIssuerSignature);
    assertEq(usdc.balanceOf(collector), 100e6);
  }

  function test_collectCredit_reverts_whenPrevSignatureNotValidAnymore() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    assertEq(usdc.balanceOf(collector), 0);

    bytes memory prevIssuerSignature = _issuerOp(100e6, block.timestamp);

    vm.startPrank(acct("admin"));
    issuerChecker.setIssuer(address(0x420));

    skip(issuerChecker.prevIssuerWindow() + 1);

    vm.startPrank(keeper);
    vm.expectRevert(Unauthorized.selector);
    account.collectCredit(FixedLib.INTERVAL, 100e6, block.timestamp, prevIssuerSignature);
  }

  function test_collectCredit_toleratesTimeDrift() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);
    assertEq(usdc.balanceOf(collector), 0);

    uint256 timestamp = block.timestamp + 1 minutes;
    account.collectCredit(FixedLib.INTERVAL, 100e6, timestamp, _issuerOp(100e6, timestamp));
    assertEq(usdc.balanceOf(collector), 100e6);
  }

  function test_collectCredit_reverts_whenTimelocked() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    uint256 timestamp = block.timestamp + 1 minutes + 1;
    vm.expectRevert(Timelocked.selector);
    account.collectCredit(FixedLib.INTERVAL, 100e6, timestamp, _issuerOp(100e6, timestamp));
  }

  function test_collectCredit_reverts_whenExpired() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    skip(365 days);
    uint256 timestamp = block.timestamp - exaPlugin.ISSUER_CHECKER().operationExpiry() - 1;
    vm.expectRevert(Expired.selector);
    account.collectCredit(FixedLib.INTERVAL, 100e6, timestamp, _issuerOp(100e6, timestamp));
  }

  function test_collectCredit_reverts_whenReplay() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    bytes memory signature = _issuerOp(100e6, block.timestamp);
    account.collectCredit(FixedLib.INTERVAL, 100e6, block.timestamp, signature);
    vm.expectRevert(Replay.selector);
    account.collectCredit(FixedLib.INTERVAL, 100e6, block.timestamp, signature);
  }

  function test_collectCredit_reverts_asNotKeeper() external {
    vm.prank(keeper);
    account.poke(exaEXA);

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.RuntimeValidationFunctionReverted.selector,
        exaPlugin,
        FunctionId.RUNTIME_VALIDATION_KEEPER,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.collectCredit(FixedLib.INTERVAL, 1, block.timestamp, _issuerOp(1, block.timestamp));
  }

  function test_collectCredit_passes_whenProposalLeavesEnoughLiquidity() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    uint256 exaUSDCBalance = exaUSDC.balanceOf(address(account));
    uint256 propose = exaUSDCBalance.mulWad(0.8e18);
    (uint256 adjustFactor,,,,) = auditor.markets(Market(address(exaUSDC)));

    uint256 credit = (exaUSDCBalance - propose).mulWad(adjustFactor) / 2;
    address receiver = address(0x420);

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaUSDC, propose, ProposalType.WITHDRAW, abi.encode(receiver)))
    );

    vm.startPrank(keeper);
    account.collectCredit(FixedLib.INTERVAL, credit, block.timestamp, _issuerOp(credit, block.timestamp));

    assertEq(usdc.balanceOf(collector), credit);
  }

  function test_collectCredit_collects_whenProposalCausesInsufficientLiquidity() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    uint256 exaUSDCBalance = exaUSDC.balanceOf(address(account));
    uint256 propose = exaUSDCBalance.mulWad(0.8e18);
    uint256 credit = exaUSDCBalance - propose;
    address receiver = address(0x420);

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaUSDC, propose, ProposalType.WITHDRAW, abi.encode(receiver)))
    );

    vm.startPrank(keeper);
    account.collectCredit(FixedLib.INTERVAL, credit, block.timestamp, _issuerOp(credit, block.timestamp));

    assertEq(usdc.balanceOf(collector), credit);
  }

  function test_collectCredit_collects_whenHealthFactorHigherThanOne() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    uint256 exaUSDCBalance = exaUSDC.balanceOf(address(account));
    uint256 credit = exaUSDCBalance / 2;

    account.collectCredit(FixedLib.INTERVAL, credit, block.timestamp, _issuerOp(credit, block.timestamp));

    assertEq(usdc.balanceOf(collector), credit);
  }

  function test_collectCredit_collects_whenProposalLeavesHealthFactorLowerThanOne() external {
    vm.prank(keeper);
    account.poke(exaUSDC);

    uint256 exaUSDCBalance = exaUSDC.balanceOf(address(account));
    uint256 credit = exaUSDCBalance / 2;

    vm.prank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaUSDC, credit, ProposalType.WITHDRAW, abi.encode(address(this))))
    );

    vm.prank(keeper);
    account.collectCredit(FixedLib.INTERVAL, credit, block.timestamp, _issuerOp(credit, block.timestamp));
  }

  function test_collectCredit_reverts_whenDisagreement() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    vm.expectRevert(Disagreement.selector);
    account.collectCredit(FixedLib.INTERVAL, 100e6, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));
    assertEq(usdc.balanceOf(collector), 0);
  }

  function test_collectCredit_collects_withEnoughSlippage() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    account.collectCredit(FixedLib.INTERVAL, 100e6, 110e6, block.timestamp, _issuerOp(100e6, block.timestamp));
    assertEq(usdc.balanceOf(collector), 100e6);
  }

  function test_collectDebit_collects() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    assertEq(usdc.balanceOf(collector), 0);
    account.collectDebit(100e6, block.timestamp, _issuerOp(100e6, block.timestamp));
    assertEq(usdc.balanceOf(collector), 100e6);
  }

  function test_collectDebit_toleratesTimeDrift() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);
    assertEq(usdc.balanceOf(collector), 0);

    uint256 timestamp = block.timestamp + 1 minutes;
    account.collectDebit(100e6, timestamp, _issuerOp(100e6, timestamp));
    assertEq(usdc.balanceOf(collector), 100e6);
  }

  function test_collectDebit_reverts_whenTimelocked() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    uint256 timestamp = block.timestamp + 1 minutes + 1;
    vm.expectRevert(Timelocked.selector);
    account.collectDebit(100e6, timestamp, _issuerOp(100e6, timestamp));
  }

  function test_collectDebit_reverts_whenExpired() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    skip(365 days);
    uint256 timestamp = block.timestamp - exaPlugin.ISSUER_CHECKER().operationExpiry() - 1;
    vm.expectRevert(Expired.selector);
    account.collectDebit(100e6, timestamp, _issuerOp(100e6, timestamp));
  }

  function test_collectDebit_reverts_whenReplay() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    bytes memory signature = _issuerOp(100e6, block.timestamp);
    account.collectDebit(100e6, block.timestamp, signature);
    vm.expectRevert(Replay.selector);
    account.collectDebit(100e6, block.timestamp, signature);
  }

  function test_collectDebit_reverts_asNotKeeper() external {
    vm.prank(keeper);
    account.poke(exaEXA);

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.RuntimeValidationFunctionReverted.selector,
        exaPlugin,
        FunctionId.RUNTIME_VALIDATION_KEEPER,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.collectDebit(1, block.timestamp, _issuerOp(1, block.timestamp));
  }

  function test_collectDebit_collects_whenProposalLeavesEnoughLiquidity() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    uint256 exaUSDCBalance = exaUSDC.balanceOf(address(account));
    uint256 propose = exaUSDCBalance.mulWad(0.8e18);
    uint256 debit = exaUSDCBalance - propose;
    address receiver = address(0x420);

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaUSDC, propose, ProposalType.WITHDRAW, abi.encode(receiver)))
    );

    vm.startPrank(keeper);
    account.collectDebit(debit, block.timestamp, _issuerOp(debit, block.timestamp));
    assertEq(usdc.balanceOf(collector), debit);
    assertEq(usdc.balanceOf(collector), debit);
  }

  function test_collectDebit_collects_whenProposalCausesInsufficientLiquidity() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    uint256 exaUSDCBalance = exaUSDC.balanceOf(address(account));
    uint256 propose = exaUSDCBalance.mulWad(0.8e18);
    uint256 debit = exaUSDCBalance - propose + 1;
    address receiver = address(0x420);

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaUSDC, propose, ProposalType.WITHDRAW, abi.encode(receiver)))
    );

    vm.startPrank(keeper);
    account.collectDebit(debit, block.timestamp, _issuerOp(debit, block.timestamp));
    assertEq(usdc.balanceOf(collector), debit);
  }

  function test_collectCollateral_collects() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    uint256 prevCollateral = exaEXA.balanceOf(address(account));

    uint256 maxAmountIn = 111e18;
    uint256 minAmountOut = 110e6;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountOut, (exaEXA.asset(), maxAmountIn, address(usdc), minAmountOut, address(exaPlugin))
    );
    uint256 balance = usdc.balanceOf(exaPlugin.collector());
    (uint256 amountIn, uint256 amountOut) = account.collectCollateral(
      minAmountOut, exaEXA, maxAmountIn, block.timestamp, route, _issuerOp(minAmountOut, block.timestamp)
    );

    assertEq(usdc.balanceOf(exaPlugin.collector()), balance + minAmountOut, "collector's usdc != expected");
    assertEq(exaUSDC.balanceOf(address(account)), amountOut - minAmountOut, "account's usdc != expected");
    assertEq(exaEXA.balanceOf(address(account)), prevCollateral - amountIn, "account's collateral != expected");

    assertEq(exaEXA.balanceOf(address(exaPlugin)), 0, "collateral dust");
    assertEq(IERC20(exaEXA.asset()).balanceOf(address(exaPlugin)), 0, "collateral asset dust");
    assertEq(usdc.balanceOf(address(exaPlugin)), 0, "usdc asset dust");
    assertEq(exaUSDC.balanceOf(address(exaPlugin)), 0, "usdc dust");
  }

  function test_collectCollateral_reverts_withDisagreement() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    uint256 maxAmountIn = 111e18;
    uint256 minAmountOut = 110e6;
    bytes memory route = abi.encodeCall(
      MockSwapper.swapExactAmountOut, (exaEXA.asset(), maxAmountIn, address(usdc), minAmountOut, address(exaPlugin))
    );
    vm.expectRevert(Disagreement.selector);
    account.collectCollateral(
      minAmountOut * 2, exaEXA, maxAmountIn, block.timestamp, route, _issuerOp(minAmountOut * 2, block.timestamp)
    );
  }

  function testFork_collectCollateral_collects() external {
    _setUpForkEnv();
    uint256 maxAmountIn = 0.0004e8;
    IMarket exaWBTC = IMarket(protocol("MarketWBTC"));
    deal(exaWBTC.asset(), address(account), maxAmountIn);
    proposalManager.allowTarget(exaWBTC.asset(), true);

    vm.startPrank(keeper);
    account.poke(exaWBTC);

    bytes memory route = bytes.concat(
      hex"4666fc80b7c64668375a12ff485d0a88dee3ac5d82d77587a6be542b9233c5eb13830c4c00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000",
      abi.encodePacked(address(exaPlugin)),
      hex"00000000000000000000000000000000000000000000000000000000018f7705000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000034578610000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002a30783030303030303030303030303030303030303030303030303030303030303030303030303030303000000000000000000000000000000000000000000000000000000000000000000000111111125421ca6dc452d289314280a0f8842a65000000000000000000000000111111125421ca6dc452d289314280a0f8842a6500000000000000000000000068f180fcce6836688e9084f035309e29bf0a20950000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff850000000000000000000000000000000000000000000000000000000000009c4000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000004e807ed2379000000000000000000000000b63aae6c353636d66df13b89ba4425cfe13d10ba00000000000000000000000068f180fcce6836688e9084f035309e29bf0a20950000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85000000000000000000000000b63aae6c353636d66df13b89ba4425cfe13d10ba0000000000000000000000001231deb6f5749ef6ce6943a275a1d3e7486f4eae0000000000000000000000000000000000000000000000000000000000009c4000000000000000000000000000000000000000000000000000000000018f770400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000039600000000000000000000000000000000000000000000000000000000037800a007e5c0d20000000000000000000000000000000000000000000000000003540000f051204c4af8dbc524681930a27b2f1af5bcc8062e6fb768f180fcce6836688e9084f035309e29bf0a209500447dc2038200000000000000000000000068f180fcce6836688e9084f035309e29bf0a209500000000000000000000000042000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000002495763e3d93b6000000000000000000000000b63aae6c353636d66df13b89ba4425cfe13d10ba00000000000000000000000042f527f50f16a103b6ccab48bccca214500c102100a0c9e75c480000000000000013130c0000000000000000000000000000000000000000000002360001d300006302a000000000000000000000000000000000000000000000000000000000005f6305ee63c1e580c1738d90e2e26c35784a0d3e3d8a9f795074bca44200000000000000000000000000000000000006111111125421ca6dc452d289314280a0f8842a655106a062ae8a9c5e11aaa026fc2670b0d65ccc8b285842000000000000000000000000000000000000060004cac88ea9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000009708bd00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000111111125421ca6dc452d289314280a0f8842a6500000000000000000000000000000000000000000000000000000000671fb839000000000000000000000000000000000000000000000000000000000000000100000000000000000000000042000000000000000000000000000000000000060000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff850000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f1046053aa5682b4f9a81b5481394da16be5ff5a02a0000000000000000000000000000000000000000000000000000000000097095eee63c1e580d4cb5566b5c16ef2f4a08b1438052013171212a24200000000000000000000000000000000000006111111125421ca6dc452d289314280a0f8842a65000000000000000000002a94d114000000000000000000000000000000000000000000000000"
    );

    uint256 balance = usdc.balanceOf(exaPlugin.collector());
    account.collectCollateral(21e6, exaWBTC, maxAmountIn, block.timestamp, route, _issuerOp(21e6, block.timestamp));
    assertEq(usdc.balanceOf(exaPlugin.collector()) - balance, 21e6);
  }

  function test_collectInstallments_collects() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    assertEq(usdc.balanceOf(collector), 0);

    uint256[] memory amounts = new uint256[](3);
    amounts[0] = 10e6;
    amounts[1] = 10e6;
    amounts[2] = 10e6;

    account.collectInstallments(
      FixedLib.INTERVAL, amounts, type(uint256).max, block.timestamp, _issuerOp(30e6, block.timestamp)
    );

    assertEq(usdc.balanceOf(collector), 30e6);
  }

  function test_collectInstallments_toleratesTimeDrift() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);
    assertEq(usdc.balanceOf(collector), 0);

    uint256 timestamp = block.timestamp + 1 minutes;
    uint256[] memory amounts = new uint256[](3);
    amounts[0] = 10e6;
    amounts[1] = 10e6;
    amounts[2] = 10e6;

    account.collectInstallments(FixedLib.INTERVAL, amounts, type(uint256).max, timestamp, _issuerOp(30e6, timestamp));
    assertEq(usdc.balanceOf(collector), 30e6);
  }

  function test_collectInstallments_reverts_whenTimelocked() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    uint256 timestamp = block.timestamp + 1 minutes + 1;
    uint256[] memory amounts = new uint256[](2);
    amounts[0] = 10e6;
    amounts[1] = 10e6;
    vm.expectRevert(Timelocked.selector);
    account.collectInstallments(FixedLib.INTERVAL, amounts, type(uint256).max, timestamp, _issuerOp(20e6, timestamp));
  }

  function test_collectInstallments_reverts_whenExpired() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    skip(365 days);
    uint256 timestamp = block.timestamp - exaPlugin.ISSUER_CHECKER().operationExpiry() - 1;
    uint256[] memory amounts = new uint256[](2);
    amounts[0] = 10e6;
    amounts[1] = 10e6;
    vm.expectRevert(Expired.selector);
    account.collectInstallments(FixedLib.INTERVAL, amounts, type(uint256).max, timestamp, _issuerOp(20e6, timestamp));
  }

  function test_collectInstallments_reverts_whenReplay() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    bytes memory signature = _issuerOp(20e6, block.timestamp);
    uint256[] memory amounts = new uint256[](2);
    amounts[0] = 10e6;
    amounts[1] = 10e6;

    account.collectInstallments(FixedLib.INTERVAL, amounts, type(uint256).max, block.timestamp, signature);
    vm.expectRevert(Replay.selector);
    account.collectInstallments(FixedLib.INTERVAL, amounts, type(uint256).max, block.timestamp, signature);
  }

  function test_collectInstallments_reverts_asNotKeeper() external {
    vm.prank(keeper);
    account.poke(exaEXA);

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.RuntimeValidationFunctionReverted.selector,
        exaPlugin,
        FunctionId.RUNTIME_VALIDATION_KEEPER,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.collectInstallments(
      FixedLib.INTERVAL, new uint256[](0), type(uint256).max, block.timestamp, _issuerOp(0, block.timestamp)
    );
  }

  function test_collectInstallments_revertsWhenNoSlippage() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    assertEq(usdc.balanceOf(collector), 0);

    uint256[] memory amounts = new uint256[](3);
    amounts[0] = 10e6;
    amounts[1] = 10e6;
    amounts[2] = 10e6;

    vm.expectRevert(stdError.arithmeticError);
    account.collectInstallments(FixedLib.INTERVAL, amounts, 30e6, block.timestamp, _issuerOp(30e6, block.timestamp));

    assertEq(usdc.balanceOf(collector), 0);
  }

  function test_poke() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
  }

  function test_pokeETH_deposits() external {
    uint256 balance = address(account).balance;

    vm.startPrank(keeper);
    account.pokeETH();

    assertEq(address(account).balance, 0, "ETH unwrapped");
    assertEq(exaWETH.maxWithdraw(address(account)), balance, "WETH left");
  }

  function test_executeProposal_reverts_whenInvalidNonce() external {
    vm.startPrank(address(account));
    account.propose(exaEXA, 1, ProposalType.WITHDRAW, abi.encode(address(this)));

    vm.expectRevert(abi.encodeWithSelector(NotNext.selector));
    account.executeProposal(1);
  }

  function test_poke_reverts_withNotMarket() external {
    vm.startPrank(keeper);
    vm.expectRevert(abi.encodeWithSelector(NotMarket.selector));
    account.poke(IMarket(address(0)));
  }

  function test_poke_reverts_withNoBalance() external {
    vm.startPrank(address(account));
    exa.transfer(address(0x1), exa.balanceOf(address(account)));

    vm.startPrank(keeper);
    vm.expectRevert(abi.encodeWithSelector(NoBalance.selector));
    account.poke(exaEXA);
  }

  // runtime validations
  function test_exitMarket_reverts() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.startPrank(owner);
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.execute(address(auditor), 0, abi.encodeCall(IAuditor.exitMarket, exaEXA));
  }

  function test_auditorCalls_passes() external {
    vm.startPrank(owner);
    account.execute(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
  }

  function test_targetNotAllowed_reverts_withUnauthorized() external {
    vm.startPrank(owner);

    MockERC20 erc20 = new MockERC20("Mock", "MTK", 18);

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.execute(address(erc20), 0, abi.encodeCall(IERC20.transfer, (address(account), 100e18)));

    vm.stopPrank();
    erc20.mint(address(account), 100e18);

    proposalManager.allowTarget(address(erc20), true);

    vm.startPrank(owner);
    account.execute(address(erc20), 0, abi.encodeCall(IERC20.transfer, (address(account), 100e18)));
  }

  function test_borrow_reverts_withUnauthorized_whenReceiverNotCollector() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.startPrank(owner);
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.execute(address(exaUSDC), 0, abi.encodeCall(IMarket.borrow, (100e6, owner, owner)));
  }

  function test_borrowAtMaturity_reverts_withNoProposal_whenReceiverNotCollector() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.startPrank(owner);
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(NoProposal.selector)
      )
    );
    account.execute(
      address(exaUSDC), 0, abi.encodeCall(IMarket.borrowAtMaturity, (FixedLib.INTERVAL, 100e6, 100e6, owner, owner))
    );
  }

  function test_executeBatch_checksEveryCall() external {
    Call[] memory calls = new Call[](4);
    calls[0] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    calls[1] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    calls[2] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    calls[3] = Call(address(auditor), 0, abi.encodeCall(IAuditor.exitMarket, exaEXA));

    vm.startPrank(owner);
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_BATCH,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.executeBatch(calls);

    calls = new Call[](3);
    calls[0] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    calls[1] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    calls[2] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));

    account.executeBatch(calls);
  }

  function test_executeBatch_supportsMultipleProposals() external {
    vm.prank(keeper);
    account.poke(exaEXA);
    uint256 amount = 30e18;
    address receiver = address(0x420);

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, amount, ProposalType.WITHDRAW, abi.encode(receiver)))
    );
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, amount, ProposalType.WITHDRAW, abi.encode(receiver)))
    );
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, amount, ProposalType.WITHDRAW, abi.encode(receiver)))
    );

    skip(proposalManager.delay());
    assertEq(exa.balanceOf(receiver), 0);

    Call[] memory calls = new Call[](6);
    calls[0] = Call(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (amount, receiver, address(account))));
    calls[1] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    calls[2] = Call(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (amount, receiver, address(account))));
    calls[3] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    calls[4] = Call(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (amount, receiver, address(account))));
    calls[5] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));

    account.executeBatch(calls);
    assertEq(exa.balanceOf(receiver), amount * 3, "receiver balance doesn't match");
  }

  function test_executeBatch_reverts_whenWithdrawingMultipleWithOneProposal() external {
    vm.prank(keeper);
    account.poke(exaEXA);
    uint256 amount = 30e18;
    address receiver = address(0x420);

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, amount, ProposalType.WITHDRAW, abi.encode(receiver)))
    );

    skip(proposalManager.delay());
    assertEq(exa.balanceOf(receiver), 0);

    Call[] memory calls = new Call[](3);
    calls[0] = Call(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (amount / 3, receiver, address(account))));
    calls[1] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    calls[2] = Call(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (amount / 3, receiver, address(account))));

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_BATCH,
        abi.encodePacked(NoProposal.selector)
      )
    );
    account.executeBatch(calls);
    assertEq(exa.balanceOf(receiver), 0, "receiver balance doesn't match");
  }

  function test_executeBatch_reverts_whenUnauthorizedCallsNested() external {
    Call[] memory maliciousCalls = new Call[](1);
    maliciousCalls[0] = Call(address(auditor), 0, abi.encodeCall(IAuditor.exitMarket, exaEXA));

    Call[] memory calls = new Call[](2);
    calls[0] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    calls[1] = Call(address(account), 0, abi.encodeCall(UpgradeableModularAccount.executeBatch, (maliciousCalls)));

    vm.startPrank(owner);
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_BATCH,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.executeBatch(calls);
  }

  function test_skippingProposal_reverts_withNoProposal() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);
    account.poke(exaUSDC);

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, 100e18, ProposalType.WITHDRAW, abi.encode(address(0x420))))
    );

    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaUSDC, 100e6, ProposalType.WITHDRAW, abi.encode(address(0x420))))
    );

    skip(proposalManager.delay());

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(NoProposal.selector)
      )
    );
    account.execute(address(exaUSDC), 0, abi.encodeCall(IERC4626.withdraw, (100e6, address(0x420), address(account))));

    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (100e18, address(0x420), address(account))));
    account.execute(address(exaUSDC), 0, abi.encodeCall(IERC4626.withdraw, (100e6, address(0x420), address(account))));
  }

  function test_borrowAtMaturity_incrementsNonce() external {
    vm.prank(keeper);
    account.poke(exaEXA);

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(
        IExaAccount.propose,
        (
          exaUSDC,
          100e6,
          ProposalType.BORROW_AT_MATURITY,
          abi.encode(
            BorrowAtMaturityData({ maturity: FixedLib.INTERVAL, maxAssets: 110e6, receiver: address(account) })
          )
        )
      )
    );

    skip(proposalManager.delay());

    uint256 nonce = proposalManager.nonces(address(account));
    account.execute(
      address(exaUSDC),
      0,
      abi.encodeCall(IMarket.borrowAtMaturity, (FixedLib.INTERVAL, 100e6, 110e6, address(account), address(account)))
    );

    assertEq(proposalManager.nonces(address(account)), nonce + 1);
  }

  function test_withdrawProposed_incrementsNonce() external {
    vm.prank(keeper);
    account.poke(exaEXA);

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, 100e18, ProposalType.WITHDRAW, abi.encode(address(0x420))))
    );
    skip(proposalManager.delay());

    uint256 nonce = proposalManager.nonces(address(account));
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (100e18, address(0x420), address(account))));

    assertEq(proposalManager.nonces(address(account)), nonce + 1);
  }

  function test_withdrawProposed_emits_proposalNonceSet() external {
    vm.prank(keeper);
    account.poke(exaEXA);

    vm.startPrank(owner);
    account.execute(
      address(account),
      0,
      abi.encodeCall(IExaAccount.propose, (exaEXA, 100e18, ProposalType.WITHDRAW, abi.encode(address(0x420))))
    );
    skip(proposalManager.delay());

    uint256 nonce = proposalManager.nonces(address(account));
    vm.expectEmit(true, true, true, true, address(proposalManager));
    emit ProposalNonceSet(address(account), nonce + 1, true);
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC4626.withdraw, (100e18, address(0x420), address(account))));
  }

  function test_collect_collects_whenProposalsLeaveNoLiquidity() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    uint256 usdcBalance = exaUSDC.maxWithdraw(address(account));

    vm.startPrank(address(account));
    for (uint256 i = 0; i < 4; ++i) {
      account.propose(exaUSDC, usdcBalance / 4, ProposalType.WITHDRAW, abi.encode(address(0x420)));
    }

    vm.startPrank(keeper);
    account.collectDebit(1, block.timestamp, _issuerOp(1, block.timestamp));
    account.collectDebit(usdcBalance / 4, block.timestamp, _issuerOp(usdcBalance / 4, block.timestamp));
  }

  function test_collect_collects_whenTooMuchProposedDebt() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);

    (uint256 adjustFactor,,,,) = auditor.markets(Market(address(exaUSDC)));

    uint256 adjustedCollateral = exaUSDC.maxWithdraw(address(account)).mulWad(adjustFactor);
    uint256 maxDebt = adjustedCollateral.mulWad(adjustFactor);

    // propose borrow at maturity 3 times with maxAssets = maxDebt / 3
    vm.startPrank(address(account));
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

    vm.startPrank(keeper);
    account.collectDebit(10, block.timestamp, _issuerOp(10, block.timestamp));

    account.collectCredit(
      FixedLib.INTERVAL,
      maxDebt / 3 - 100e6,
      maxDebt / 3,
      block.timestamp,
      _issuerOp(maxDebt / 3 - 100e6, block.timestamp)
    );
  }

  // pre execution hooks

  function test_approveMarket_reverts_whenNotAllowlisted() external {
    vm.startPrank(owner);
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.execute(address(exaUSDC), 0, abi.encodeCall(IERC20.approve, (address(this), 100e6)));
  }

  function test_rollFixed_reverts__withNoProposal_proposalTypeDiffers() external {
    vm.startPrank(address(account));

    account.propose(exaEXA, 100e18, ProposalType.WITHDRAW, abi.encode(address(0x420)));

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(NoProposal.selector)
      )
    );
    account.execute(
      address(debtManager), 0, abi.encodeCall(IDebtManager.rollFixed, (exaEXA, 100e18, 100e18, 100e18, 100e18, 100e18))
    );
  }

  function test_rollFixed_reverts_whenTimelocked() external {
    vm.startPrank(address(account));

    account.propose(exaEXA, 100e18, ProposalType.ROLL_DEBT, abi.encode(address(0x420)));

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(Timelocked.selector)
      )
    );
    account.execute(
      address(debtManager), 0, abi.encodeCall(IDebtManager.rollFixed, (exaEXA, 100e18, 100e18, 100e18, 100e18, 100e18))
    );
  }

  function test_rollFixed_reverts_withNoProposal_whenRollDataDiffers() external {
    vm.startPrank(address(account));
    account.propose(
      exaEXA,
      100e18,
      ProposalType.ROLL_DEBT,
      abi.encode(
        RollDebtData({
          repayMaturity: FixedLib.INTERVAL,
          borrowMaturity: FixedLib.INTERVAL * 2,
          maxRepayAssets: 100e18,
          percentage: 1e18
        })
      )
    );
    skip(proposalManager.delay());

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(NoProposal.selector)
      )
    );
    account.execute(
      address(debtManager), 0, abi.encodeCall(IDebtManager.rollFixed, (exaEXA, 100e18, 100e18, 100e18, 100e18, 100e18))
    );
  }

  function test_debtManagerCalls_revert_withUnauthorized_whenSelectorNotRollFixed() external {
    vm.startPrank(address(account));

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.execute(address(debtManager), 0, abi.encodeCall(IAuditor.enterMarket, (exaEXA)));
  }

  function test_installmentsRouterCalls_revert_withUnauthorized_whenSelectorNotBorrow() external {
    vm.startPrank(address(account));

    address router = address(exaPlugin.INSTALLMENTS_ROUTER());
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    account.execute(router, 0, abi.encodeCall(IAuditor.enterMarket, (exaEXA)));
  }

  function test_borrowToCollector_borrows() external {
    vm.prank(keeper);
    account.poke(exaEXA);

    vm.startPrank(owner);
    account.execute(address(exaUSDC), 0, abi.encodeCall(IMarket.borrow, (100e6, collector, address(account))));

    assertEq(usdc.balanceOf(collector), 100e6);
  }

  function test_borrowAtMaturity_reverts_whenTimelocked() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    uint256 maturity = FixedLib.INTERVAL;
    vm.startPrank(address(account));
    account.propose(
      exaUSDC,
      100e6,
      ProposalType.BORROW_AT_MATURITY,
      abi.encode(BorrowAtMaturityData({ maturity: maturity, maxAssets: 110e6, receiver: address(account) }))
    );

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(Timelocked.selector)
      )
    );
    account.execute(
      address(exaUSDC),
      0,
      abi.encodeCall(IMarket.borrowAtMaturity, (maturity, 100e6, 110e6, address(account), address(account)))
    );
  }

  function test_borrowAtMaturity_reverts_withNoProposal_whenDataDiffers() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    uint256 maturity = FixedLib.INTERVAL;
    vm.startPrank(address(account));
    account.propose(
      exaUSDC,
      100e6,
      ProposalType.BORROW_AT_MATURITY,
      abi.encode(BorrowAtMaturityData({ maturity: maturity, maxAssets: 110e6, receiver: address(account) }))
    );

    skip(proposalManager.delay());

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(NoProposal.selector)
      )
    );
    account.execute(
      address(exaUSDC),
      0,
      abi.encodeCall(IMarket.borrowAtMaturity, (maturity, 100e6 + 1, 110e6, address(account), address(account)))
    );
  }

  function test_exaPluginConstructor_reverts_whenSwapperIsZeroAddress() external {
    vm.expectRevert(ZeroAddress.selector);
    new ExaPlugin(
      Parameters({
        owner: address(this),
        auditor: IAuditor(address(this)),
        exaUSDC: exaUSDC,
        exaWETH: exaWETH,
        flashLoaner: IFlashLoaner(address(this)),
        debtManager: IDebtManager(address(this)),
        installmentsRouter: IInstallmentsRouter(address(this)),
        issuerChecker: issuerChecker,
        proposalManager: IProposalManager(address(proposalManager)),
        collector: collector,
        swapper: address(0),
        firstKeeper: keeper
      })
    );
  }

  // base plugin

  function test_uninstallAndInstall_installs_whenPluginIsAllowed() external {
    exaPlugin.allowPlugin(address(exaPlugin), true);

    Call[] memory calls = new Call[](4);
    calls[0] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    calls[1] =
      Call(address(account), 0, abi.encodeCall(UpgradeableModularAccount.uninstallPlugin, (address(exaPlugin), "", "")));
    calls[2] = Call(
      address(account),
      0,
      abi.encodeCall(
        UpgradeableModularAccount.installPlugin,
        (address(exaPlugin), keccak256(abi.encode(exaPlugin.pluginManifest())), "", new FunctionReference[](0))
      )
    );
    calls[3] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    vm.startPrank(address(account));
    account.executeBatch(calls);
  }

  function test_uninstall_reverts_withUnauthorized_whenExecute() external {
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    vm.startPrank(address(account));
    account.execute(
      address(account), 0, abi.encodeCall(UpgradeableModularAccount.uninstallPlugin, (address(exaPlugin), "", ""))
    );
  }

  function test_forceUninstall_reverts_withUnauthorized_withoutExecute() external {
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_UNINSTALL,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    vm.startPrank(owner);
    account.uninstallPlugin(
      address(exaPlugin),
      abi.encode(
        UpgradeableModularAccount.UninstallPluginConfig({
          serializedManifest: "",
          forceUninstall: true,
          callbackGasLimit: 0
        })
      ),
      ""
    );
  }

  function test_uninstall_reverts_withUnauthorized_whenInsideBatch() external {
    Call[] memory calls = new Call[](1);
    calls[0] =
      Call(address(account), 0, abi.encodeCall(UpgradeableModularAccount.uninstallPlugin, (address(exaPlugin), "", "")));
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_BATCH,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    vm.startPrank(address(account));
    account.executeBatch(calls);
  }

  function test_uninstall_reverts_withUnauthorized_whenNotAllowedPlugin() external {
    Call[] memory calls = new Call[](2);
    calls[0] =
      Call(address(account), 0, abi.encodeCall(UpgradeableModularAccount.uninstallPlugin, (address(exaPlugin), "", "")));
    calls[1] = Call(
      address(account),
      0,
      abi.encodeCall(
        UpgradeableModularAccount.installPlugin,
        (address(exaPlugin), keccak256(abi.encode(exaPlugin.pluginManifest())), "", new FunctionReference[](0))
      )
    );
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_BATCH,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    vm.startPrank(address(account));
    account.executeBatch(calls);
  }

  function test_uninstall_reverts_whitUnauthorized_whenNextCallIsNotInstall() external {
    Call[] memory calls = new Call[](2);
    calls[0] =
      Call(address(account), 0, abi.encodeCall(UpgradeableModularAccount.uninstallPlugin, (address(exaPlugin), "", "")));
    calls[1] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_BATCH,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    vm.startPrank(address(account));
    account.executeBatch(calls);
  }

  function test_uninstall_reverts_whenInsideExecuteOfExecuteBatch() external {
    Call[] memory calls = new Call[](2);
    calls[0] = Call(address(auditor), 0, abi.encodeCall(IAuditor.enterMarket, exaEXA));
    calls[1] = Call(
      address(account),
      0,
      abi.encodeCall(
        UpgradeableModularAccount.execute,
        (address(account), 0, abi.encodeCall(UpgradeableModularAccount.uninstallPlugin, (address(exaPlugin), "", "")))
      )
    );

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    vm.startPrank(address(account));
    account.executeBatch(calls);
  }

  function test_uninstall_reverts_whenExecuteBatchInsideExecute() external {
    Call[] memory calls = new Call[](1);
    calls[0] = Call(
      address(account),
      0,
      abi.encodeCall(
        UpgradeableModularAccount.execute,
        (address(account), 0, abi.encodeCall(UpgradeableModularAccount.uninstallPlugin, (address(exaPlugin), "", "")))
      )
    );

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    vm.startPrank(address(account));
    account.execute(address(account), 0, abi.encodeCall(UpgradeableModularAccount.executeBatch, calls));
  }

  function test_install_installs_whenNotRelatedPlugin() external {
    vm.startPrank(owner);
    account.installPlugin(
      address(new BadPlugin()), keccak256(abi.encode(new BadPlugin().pluginManifest())), "", new FunctionReference[](0)
    );
  }

  function test_install_reverts_whenAlreadyInstalled() external {
    ExaPlugin newPlugin = new ExaPlugin(
      Parameters({
        owner: address(this),
        auditor: IAuditor(address(auditor)),
        exaUSDC: exaUSDC,
        exaWETH: exaWETH,
        flashLoaner: IFlashLoaner(address(this)),
        debtManager: IDebtManager(address(this)),
        installmentsRouter: IInstallmentsRouter(address(this)),
        issuerChecker: issuerChecker,
        proposalManager: IProposalManager(address(proposalManager)),
        collector: collector,
        swapper: address(this),
        firstKeeper: keeper
      })
    );
    exaPlugin.allowPlugin(address(newPlugin), true);

    Call[] memory calls = new Call[](1);
    calls[0] = Call(
      address(account),
      0,
      abi.encodeCall(
        UpgradeableModularAccount.installPlugin,
        (address(newPlugin), keccak256(abi.encode(newPlugin.pluginManifest())), "", new FunctionReference[](0))
      )
    );
    vm.expectRevert(
      abi.encodeWithSelector(PluginManagerInternals.ExecutionFunctionAlreadySet.selector, IExaAccount.swap.selector)
    );
    vm.startPrank(address(account));
    account.executeBatch(calls);
  }

  function test_uninstall_uninstalls_whenItsAnotherPlugin() external {
    BadPlugin badPlugin = new BadPlugin();
    vm.startPrank(owner);
    account.installPlugin(
      address(badPlugin), keccak256(abi.encode(badPlugin.pluginManifest())), "", new FunctionReference[](0)
    );
    account.uninstallPlugin(address(badPlugin), "", "");
  }

  function test_uninstall_uninstalls_whenExecuteWithAnotherPlugin() external {
    BadPlugin badPlugin = new BadPlugin();
    vm.startPrank(owner);
    account.installPlugin(
      address(badPlugin), keccak256(abi.encode(badPlugin.pluginManifest())), "", new FunctionReference[](0)
    );
    account.execute(
      address(account), 0, abi.encodeCall(UpgradeableModularAccount.uninstallPlugin, (address(badPlugin), "", ""))
    );
  }

  function test_uninstall_uninstalls_whenBatchedWithAnotherPlugin() external {
    BadPlugin badPlugin = new BadPlugin();
    vm.startPrank(owner);
    account.installPlugin(
      address(badPlugin), keccak256(abi.encode(badPlugin.pluginManifest())), "", new FunctionReference[](0)
    );
    Call[] memory calls = new Call[](1);
    calls[0] =
      Call(address(account), 0, abi.encodeCall(UpgradeableModularAccount.uninstallPlugin, (address(badPlugin), "", "")));
    account.executeBatch(calls);
  }

  function test_uninstall_reverts_whenPendingProposals() external {
    exaPlugin.allowPlugin(address(exaPlugin), true);

    Call[] memory calls = new Call[](2);
    calls[0] =
      Call(address(account), 0, abi.encodeCall(UpgradeableModularAccount.uninstallPlugin, (address(exaPlugin), "", "")));
    calls[1] = Call(
      address(account),
      0,
      abi.encodeCall(
        UpgradeableModularAccount.installPlugin,
        (address(exaPlugin), keccak256(abi.encode(exaPlugin.pluginManifest())), "", new FunctionReference[](0))
      )
    );

    vm.startPrank(address(account));
    account.propose(exaEXA, 100e18, ProposalType.WITHDRAW, "");
    account.propose(exaEXA, 100e18, ProposalType.WITHDRAW, "");

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_BATCH,
        abi.encodeWithSelector(PendingProposals.selector)
      )
    );
    account.executeBatch(calls);
  }

  function test_uninstall_uninstalls_whenWrongProposalManager() external {
    exaPlugin.allowPlugin(address(exaPlugin), true);
    Call[] memory calls = new Call[](2);
    calls[0] =
      Call(address(account), 0, abi.encodeCall(UpgradeableModularAccount.uninstallPlugin, (address(exaPlugin), "", "")));
    calls[1] = Call(
      address(account),
      0,
      abi.encodeCall(
        UpgradeableModularAccount.installPlugin,
        (address(exaPlugin), keccak256(abi.encode(exaPlugin.pluginManifest())), "", new FunctionReference[](0))
      )
    );

    exaPlugin.setProposalManager(IProposalManager(address(0x1)));

    vm.startPrank(address(account));
    account.executeBatch(calls);
  }

  function test_uninstall_reverts_withUnauthorized_withoutExecute() external {
    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_UNINSTALL,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    vm.startPrank(owner);
    account.uninstallPlugin(address(exaPlugin), "", "");
  }

  function test_postExecutionHook_reverts_withNotImplemented() external {
    vm.expectRevert(
      abi.encodeWithSelector(BasePlugin.NotImplemented.selector, BasePlugin.postExecutionHook.selector, 69)
    );
    exaPlugin.postExecutionHook(69, "");
  }

  function test_preExecutionHook_reverts_withNotImplemented() external {
    vm.expectRevert(
      abi.encodeWithSelector(BasePlugin.NotImplemented.selector, BasePlugin.preExecutionHook.selector, 69)
    );
    exaPlugin.preExecutionHook(69, address(this), 0, "");
  }

  function test_runtimeValidationFunction_reverts_withNotImplemented() external {
    vm.expectRevert(
      abi.encodeWithSelector(
        BasePlugin.NotImplemented.selector, BasePlugin.runtimeValidationFunction.selector, type(uint8).max
      )
    );
    exaPlugin.runtimeValidationFunction(type(uint8).max, address(this), 0, "");
  }

  function test_pluginMetadata() external view {
    PluginMetadata memory pluginMetadata = exaPlugin.pluginMetadata();
    assertEq(pluginMetadata.name, "Exa Plugin");
    assertEq(pluginMetadata.author, "Exactly");
  }

  // refunder

  function test_refund_refunds() external {
    vm.startPrank(keeper);

    uint256 balance = exaUSDC.balanceOf(address(account));
    deal(address(usdc), address(refunder), 100e6);
    refunder.refund(address(account), 100e6, block.timestamp, _issuerOp(100e6, block.timestamp, true));
    assertEq(exaUSDC.balanceOf(address(account)), balance + 100e6);
  }

  function test_refund_refunds_whenCollectedAtSameTime() external {
    vm.startPrank(keeper);
    account.poke(exaUSDC);
    account.collectDebit(100e6, block.timestamp, _issuerOp(100e6, block.timestamp));

    uint256 balance = exaUSDC.balanceOf(address(account));
    deal(address(usdc), address(refunder), 100e6);
    refunder.refund(address(account), 100e6, block.timestamp, _issuerOp(100e6, block.timestamp, true));
    assertEq(exaUSDC.balanceOf(address(account)), balance + 100e6);
  }

  // issuer checker

  function test_issuerChecker_emits_collected() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    vm.expectEmit(true, true, true, true, address(issuerChecker));
    emit Collected(address(account), 100e6, block.timestamp);
    account.collectCredit(FixedLib.INTERVAL, 100e6, block.timestamp, _issuerOp(100e6, block.timestamp));
  }

  function test_issuerChecker_emits_refunded() external {
    vm.startPrank(keeper);
    deal(address(usdc), address(refunder), 100e6);

    vm.expectEmit(true, true, true, true, address(issuerChecker));
    emit Refunded(address(account), 100e6, block.timestamp);
    refunder.refund(address(account), 100e6, block.timestamp, _issuerOp(100e6, block.timestamp, true));
  }

  // admin functions

  function test_setFlashLoaner_sets_whenAdmin() external {
    exaPlugin.setFlashLoaner(IFlashLoaner(address(0x1)));
    assertEq(address(exaPlugin.flashLoaner()), address(0x1));
  }

  function test_setFlashLoaner_emitsFlashLoanerSet() external {
    vm.expectEmit(true, true, true, true, address(exaPlugin));
    emit FlashLoanerSet(address(this), IFlashLoaner(address(0x1)));
    exaPlugin.setFlashLoaner(IFlashLoaner(address(0x1)));
  }

  function test_setFlashLoaner_reverts_whenNotAdmin() external {
    vm.startPrank(address(0x1));
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector, address(0x1), exaPlugin.DEFAULT_ADMIN_ROLE()
      )
    );
    exaPlugin.setFlashLoaner(IFlashLoaner(address(0x2)));
  }

  function test_setFlashLoaner_reverts_whenAddressZero() external {
    vm.expectRevert(ZeroAddress.selector);
    exaPlugin.setFlashLoaner(IFlashLoaner(address(0)));
  }

  function test_setCollector_sets_whenAdmin() external {
    exaPlugin.setCollector(address(0x1));
    assertEq(exaPlugin.collector(), address(0x1));
  }

  function test_setCollector_reverts_whenNotAdmin() external {
    address nonAdmin = address(0x1);
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector, nonAdmin, exaPlugin.DEFAULT_ADMIN_ROLE()
      )
    );
    exaPlugin.setCollector(address(0x2));
  }

  function test_setCollector_reverts_whenAddressZero() external {
    vm.expectRevert(ZeroAddress.selector);
    exaPlugin.setCollector(address(0));
  }

  function test_setCollector_emitsCollectorSet() external {
    address newCollector = address(0x1);
    vm.expectEmit(true, true, true, true, address(exaPlugin));
    emit CollectorSet(newCollector, address(this));
    exaPlugin.setCollector(newCollector);
  }

  function test_setSwapper_sets_whenAdmin() external {
    exaPlugin.setSwapper(address(0x1));
    assertEq(exaPlugin.swapper(), address(0x1));
  }

  function test_setSwapper_emitsSwapperSet() external {
    address newSwapper = address(0x1);
    vm.expectEmit(true, true, true, true, address(exaPlugin));
    emit SwapperSet(newSwapper, address(this));
    exaPlugin.setSwapper(newSwapper);
  }

  function test_setSwapper_reverts_whenNotAdmin() external {
    address nonAdmin = address(0x1);
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector, nonAdmin, exaPlugin.DEFAULT_ADMIN_ROLE()
      )
    );
    exaPlugin.setSwapper(address(0x2));
  }

  function test_setSwapper_reverts_whenAddressZero() external {
    vm.expectRevert(ZeroAddress.selector);
    exaPlugin.setSwapper(address(0));
  }

  function test_allowPlugin_sets_whenAdmin() external {
    exaPlugin.allowPlugin(address(0x1), true);
    assertTrue(exaPlugin.allowlist(address(0x1)), "plugin not allowed");
  }

  function test_allowPlugin_reverts_whenNotAdmin() external {
    address nonAdmin = address(0x1);
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector, nonAdmin, exaPlugin.DEFAULT_ADMIN_ROLE()
      )
    );
    exaPlugin.allowPlugin(address(0x1), true);
  }

  function test_allowPlugin_reverts_whenAddressZero() external {
    vm.expectRevert(ZeroAddress.selector);
    exaPlugin.allowPlugin(address(0), true);
  }

  function test_allowPlugin_emitsPluginAllowed() external {
    address plugin = address(0x1);
    vm.expectEmit(true, true, true, true, address(exaPlugin));
    emit PluginAllowed(plugin, address(this), true);
    exaPlugin.allowPlugin(plugin, true);
  }

  function test_setProposalManager_sets_whenAdmin() external {
    exaPlugin.setProposalManager(IProposalManager(address(0x1)));
    assertEq(address(exaPlugin.proposalManager()), address(0x1));
  }

  function test_setProposalManager_reverts_whenNotAdmin() external {
    address nonAdmin = address(0x1);
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector, nonAdmin, exaPlugin.DEFAULT_ADMIN_ROLE()
      )
    );
    exaPlugin.setProposalManager(IProposalManager(address(0x2)));
  }

  function test_setProposalManager_reverts_whenAddressZero() external {
    vm.expectRevert(ZeroAddress.selector);
    exaPlugin.setProposalManager(IProposalManager(address(0)));
  }

  function test_setProposalManager_emitsProposalManagerSet() external {
    IProposalManager newProposalManager = IProposalManager(address(0x1));
    vm.expectEmit(true, true, true, true, address(exaPlugin));
    emit ProposalManagerSet(newProposalManager, address(this));
    exaPlugin.setProposalManager(newProposalManager);
  }

  // proposal manager admin tests

  function test_allowTarget_sets_whenAdmin() external {
    address target = address(0x1);
    proposalManager.allowTarget(target, true);
    assert(proposalManager.allowlist(target));
  }

  function test_allowTarget_reverts_whenNotAdmin() external {
    address nonAdmin = address(0x1);
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector, nonAdmin, exaPlugin.DEFAULT_ADMIN_ROLE()
      )
    );
    proposalManager.allowTarget(address(0x1), true);
  }

  function test_allowTarget_reverts_whenAddressZero() external {
    vm.expectRevert(ZeroAddress.selector);
    proposalManager.allowTarget(address(0), true);
  }

  function test_allowTarget_emitsTargetAllowed() external {
    address target = address(0x1);
    vm.expectEmit(true, true, true, true, address(proposalManager));
    emit TargetAllowed(target, address(this), true);
    proposalManager.allowTarget(target, true);

    vm.expectEmit(true, true, true, true, address(proposalManager));
    emit TargetAllowed(target, address(this), false);
    proposalManager.allowTarget(target, false);
  }

  function test_setDelay_sets_whenAdmin() external {
    uint256 delay = 1 hours;
    proposalManager.setDelay(delay);
    assertEq(proposalManager.delay(), delay);
  }

  function test_setDelay_reverts_whenZero() external {
    vm.expectRevert(InvalidDelay.selector);
    proposalManager.setDelay(0);
  }

  function test_setDelay_reverts_whenHigherThanOneHours() external {
    vm.expectRevert(InvalidDelay.selector);
    proposalManager.setDelay(1 hours + 1);
  }

  function test_setDelay_emitsDelaySet() external {
    uint256 delay = 1 hours;
    vm.expectEmit(true, true, true, true, address(proposalManager));
    emit DelaySet(delay);
    proposalManager.setDelay(delay);
  }

  function test_setDelay_reverts_whenNotAdmin() external {
    address nonAdmin = address(0x1);
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector, nonAdmin, exaPlugin.DEFAULT_ADMIN_ROLE()
      )
    );
    proposalManager.setDelay(1 hours);
  }

  // proposal manager tests
  function test_userOpValidationFunction_reverts_withBadPlugin() external {
    vm.startPrank(owner);
    account.installPlugin(
      address(new BadPlugin()), keccak256(abi.encode(new BadPlugin().pluginManifest())), "", new FunctionReference[](0)
    );
    vm.stopPrank();
    UserOperation[] memory userOps = new UserOperation[](1);

    userOps[0] = _op(abi.encodeCall(IExaAccount.poke, (exaEXA)), ownerKey);
    vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA23 reverted (or OOG)"));
    ENTRYPOINT.handleOps(userOps, payable(address(0x420)));

    userOps[0] = _op(
      abi.encodeCall(
        UpgradeableModularAccount.execute, (address(account), 0, abi.encodeCall(IExaAccount.poke, (exaEXA)))
      ),
      ownerKey
    );
    vm.expectEmit(true, true, true, true, address(ENTRYPOINT));
    emit UserOperationRevertReason(
      ENTRYPOINT.getUserOpHash(userOps[0]),
      address(account),
      0,
      abi.encodeWithSelector(
        UpgradeableModularAccount.RuntimeValidationFunctionReverted.selector,
        exaPlugin,
        FunctionId.RUNTIME_VALIDATION_KEEPER,
        abi.encodeWithSelector(Unauthorized.selector)
      )
    );
    ENTRYPOINT.handleOps(userOps, payable(address(0x420)));
  }

  function test_setNonce_reverts_whenNonceTooLow() external {
    vm.startPrank(address(exaPlugin));
    vm.expectRevert(NonceTooLow.selector);
    proposalManager.setNonce(address(account), 0);
  }

  function test_setNonce_reverts_whenNonceTooHigh() external {
    vm.startPrank(address(exaPlugin));
    vm.expectRevert(NoProposal.selector);
    proposalManager.setNonce(address(account), 1);
  }

  function test_setNonce_reverts_whenNotProposer() external {
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), proposalManager.PROPOSER_ROLE()
      )
    );
    proposalManager.setNonce(address(account), 1);
  }

  function test_propose_reverts_whenNotProposer() external {
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), proposalManager.PROPOSER_ROLE()
      )
    );
    proposalManager.propose(address(account), exaEXA, 100e18, ProposalType.WITHDRAW, "");
  }

  function test_propose_incrementsQueueNonces() external {
    vm.startPrank(address(exaPlugin));
    uint256 nonceBefore = proposalManager.queueNonces(address(account));
    proposalManager.propose(address(account), exaEXA, 100e18, ProposalType.WITHDRAW, "");
    assertEq(proposalManager.queueNonces(address(account)), nonceBefore + 1);
  }

  function test_proposeZeroAmount_reverts_withZeroAmount() external {
    vm.startPrank(address(exaPlugin));
    vm.expectRevert(ZeroAmount.selector);
    proposalManager.propose(address(account), exaEXA, 0, ProposalType.WITHDRAW, "");
  }

  function test_proposeRepay_reverts_whenWrongType() external {
    vm.startPrank(keeper);

    vm.expectRevert(Unauthorized.selector);
    account.proposeRepay(exaUSDC, 0, ProposalType.WITHDRAW, "");
  }

  function test_transferShares_reverts_whenNoRightProposal() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    uint256 amount = 200e18;
    vm.startPrank(address(account));
    account.propose(exaEXA, amount, ProposalType.WITHDRAW, abi.encode(address(0x1)));

    vm.expectRevert(
      abi.encodeWithSelector(
        UpgradeableModularAccount.PreExecHookReverted.selector,
        exaPlugin,
        FunctionId.EXECUTION_HOOK_SINGLE,
        abi.encodePacked(Unauthorized.selector)
      )
    );
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC20.transfer, (address(0x1), amount)));
  }

  function test_transferShares_transfers_whenRedeemProposalPresent() external {
    vm.startPrank(keeper);
    account.poke(exaEXA);

    uint256 amount = 100e18;
    address receiver = address(0x1);

    vm.startPrank(address(account));
    account.propose(exaEXA, amount, ProposalType.REDEEM, abi.encode(receiver));
    skip(proposalManager.delay());

    uint256 balance = exaEXA.balanceOf(address(account));
    account.execute(address(exaEXA), 0, abi.encodeCall(IERC20.transfer, (receiver, amount)));

    assertEq(exaEXA.balanceOf(receiver), amount);
    assertEq(exaEXA.balanceOf(address(account)), balance - amount);
  }

  function test_propose_reverts_whenNoneType() external {
    vm.startPrank(address(account));
    vm.expectRevert(InvalidProposal.selector);
    account.propose(exaEXA, 1, ProposalType.NONE, abi.encode(address(account)));
  }

  // solhint-enable func-name-mixedcase

  function _issuerOp(uint256 amount, uint256 timestamp) internal view returns (bytes memory signature) {
    return _issuerOp(amount, timestamp, false);
  }

  function _issuerOp(uint256 amount, uint256 timestamp, bool refund) internal view returns (bytes memory signature) {
    return _sign(
      issuerKey,
      keccak256(
        abi.encodePacked(
          "\x19\x01",
          domainSeparator,
          keccak256(
            abi.encode(
              keccak256(
                bytes(
                  refund
                    ? "Refund(address account,uint256 amount,uint40 timestamp)"
                    : "Collection(address account,uint256 amount,uint40 timestamp)"
                )
              ),
              account,
              amount,
              timestamp
            )
          )
        )
      )
    );
  }

  function _op(bytes memory callData, uint256 privateKey) internal view returns (UserOperation memory op) {
    op = _op(callData, privateKey, 0);
  }

  function _op(bytes memory callData, uint256 privateKey, uint256 index)
    internal
    view
    returns (UserOperation memory op)
  {
    op = _unsignedOp(callData, index);
    op.signature = abi.encodePacked(
      ownerPlugin.ownerIndexOf(address(account), PublicKey(uint256(uint160(vm.addr(privateKey))), 0)),
      _sign(privateKey, ENTRYPOINT.getUserOpHash(op).toEthSignedMessageHash())
    );
  }

  function _setUpForkEnv() internal {
    vm.createSelectFork("optimism", 127_050_624);
    account = ExaAccount(payable(0x6120Fb2A9d47f7955298b80363F00C620dB9f6E6));
    issuerChecker = new IssuerChecker(address(this), issuer, 1 minutes, 1 minutes);
    issuerChecker.setIssuer(issuer);
    domainSeparator = issuerChecker.DOMAIN_SEPARATOR();

    address[] memory targets = new address[](3);
    targets[0] = IMarket(protocol("MarketUSDC")).asset();
    targets[1] = IMarket(protocol("MarketWETH")).asset();
    targets[2] = IMarket(protocol("MarketWBTC")).asset();
    proposalManager = new ProposalManager(
      address(this),
      IAuditor(protocol("Auditor")),
      IDebtManager(protocol("DebtManager")),
      IInstallmentsRouter(protocol("InstallmentsRouter")),
      acct("collector"),
      targets,
      1 minutes
    );
    proposalManager.allowTarget(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE, true); // swapper
    proposalManager.allowTarget(address(exa), true);

    exaPlugin = new ExaPlugin(
      Parameters({
        owner: address(this),
        auditor: IAuditor(protocol("Auditor")),
        exaUSDC: IMarket(protocol("MarketUSDC")),
        exaWETH: IMarket(protocol("MarketWETH")),
        flashLoaner: IFlashLoaner(protocol("BalancerVault")),
        debtManager: IDebtManager(protocol("DebtManager")),
        installmentsRouter: IInstallmentsRouter(protocol("InstallmentsRouter")),
        issuerChecker: issuerChecker,
        proposalManager: proposalManager,
        collector: acct("collector"),
        swapper: 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE,
        firstKeeper: keeper
      })
    );

    proposalManager.grantRole(proposalManager.PROPOSER_ROLE(), address(exaPlugin));

    usdc = MockERC20(protocol("USDC"));
    exaUSDC = IMarket(protocol("MarketUSDC"));

    vm.startPrank(address(account));
    account.execute(
      address(account),
      0,
      abi.encodeCall(UpgradeableModularAccount.uninstallPlugin, (0x9aac010e4EE770168182A4a65E07aab36b1cA526, "", ""))
    );
    account.execute(
      address(account),
      0,
      abi.encodeCall(
        UpgradeableModularAccount.installPlugin,
        (address(exaPlugin), keccak256(abi.encode(exaPlugin.pluginManifest())), "", new FunctionReference[](0))
      )
    );
    vm.stopPrank();
  }

  function _sign(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory) {
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
    return abi.encodePacked(r, s, v);
  }

  function _unsignedOp(bytes memory callData, uint256 index) internal view returns (UserOperation memory op) {
    op = UserOperation({
      sender: address(account),
      nonce: account.getNonce() + index,
      initCode: "",
      callData: callData,
      callGasLimit: 1 << 24,
      verificationGasLimit: 1 << 24,
      preVerificationGas: 1 << 24,
      maxFeePerGas: 1 << 8,
      maxPriorityFeePerGas: 1 << 8,
      paymasterAndData: "",
      signature: ""
    });
  }

  receive() external payable { } // solhint-disable-line no-empty-blocks
}

abstract contract ExaAccount is UpgradeableModularAccount, IExaAccount { } // solhint-disable-line no-empty-blocks

contract BadPlugin is BasePlugin {
  function userOpValidationFunction(uint8, UserOperation calldata, bytes32) external pure override returns (uint256) {
    return 0;
  }

  function onInstall(bytes calldata) external override { } // solhint-disable-line no-empty-blocks

  function onUninstall(bytes calldata) external override { } // solhint-disable-line no-empty-blocks

  function pluginManifest() external pure override returns (PluginManifest memory manifest) {
    manifest.userOpValidationFunctions = new ManifestAssociatedFunction[](1);
    manifest.userOpValidationFunctions[0] = ManifestAssociatedFunction({
      executionSelector: IExaAccount.poke.selector,
      associatedFunction: ManifestFunction({
        functionType: ManifestAssociatedFunctionType.SELF,
        functionId: 0,
        dependencyIndex: 0
      })
    });
  }
}

event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason);

error Disagreement();

interface IRewardsController {
  function allClaimable(address account, IERC20 reward) external view returns (uint256 unclaimedRewards);
  function allClaimable(address account) external view returns (AllClaimable[] memory unclaimedRewards);
  function claimAll(address to) external returns (IERC20[] memory rewardsList, uint256[] memory claimedAmounts);
}

interface IEscrowedEXA is IERC20 {
  function vest(uint128 amount, address to, uint256 maxRatio, uint256 maxPeriod) external returns (uint256 streamId);
  function vestingPeriod() external view returns (uint256);
  function withdrawMax(uint256[] memory streamIds) external;
}

interface IStakedEXA is IERC4626 {
  function claim(IERC20 reward) external;
  function refTime() external view returns (uint256);
}

struct AllClaimable {
  IERC20 reward;
  Claimable[] claimable;
}

struct Claimable {
  address token;
  uint256 amount;
}
