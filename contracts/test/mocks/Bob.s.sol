// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { Previewer } from "@exactly/protocol/periphery/Previewer.sol";
import { FixedLib } from "@exactly/protocol/utils/FixedLib.sol";

import { Call, IStandardExecutor } from "modular-account-libs/interfaces/IStandardExecutor.sol";

import { LibString } from "solady/utils/LibString.sol";

import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { OwnersLib } from "webauthn-owner-plugin/OwnersLib.sol";

import { BaseScript } from "../../script/Base.s.sol";
import { ExaAccountFactory } from "../../src/ExaAccountFactory.sol";
import { ExaPlugin } from "../../src/ExaPlugin.sol";
import {
  BorrowAtMaturityData,
  CrossRepayData,
  IERC20,
  IExaAccount,
  IMarket,
  ProposalType,
  RepayData,
  SwapData
} from "../../src/IExaAccount.sol";
import { IssuerChecker } from "../../src/IssuerChecker.sol";
import { ProposalManager } from "../../src/ProposalManager.sol";

import { MockSwapper } from "./MockSwapper.sol";

contract BobScript is BaseScript {
  using OwnersLib for address[];
  using LibString for address;
  using LibString for uint256;

  MockERC20 public exa;
  MockERC20 public usdc;
  IMarket public exaEXA;
  IMarket public exaUSDC;
  IMarket public exaWETH;
  Previewer public previewer;
  ExaPlugin public exaPlugin;
  ProposalManager public proposalManager;
  IssuerChecker internal issuerChecker;
  ExaAccountFactory public factory;

  address public bob;
  uint256 public bobKey = 0xb0b;
  IExaAccount public bobAccount;
  bytes32 internal domainSeparator;

  function setUp() external {
    protocol("Auditor");
    exa = MockERC20(protocol("EXA"));
    usdc = MockERC20(protocol("USDC"));
    exaEXA = IMarket(protocol("MarketEXA"));
    exaUSDC = IMarket(protocol("MarketUSDC"));
    exaWETH = IMarket(protocol("MarketWETH"));
    previewer = Previewer(protocol("Previewer"));

    proposalManager = ProposalManager(broadcast("ProposalManager"));
    issuerChecker = IssuerChecker(broadcast("IssuerChecker"));
    exaPlugin = ExaPlugin(payable(broadcast("ExaPlugin")));
    factory = ExaAccountFactory(
      payable(
        CREATE3_FACTORY.getDeployed(
          acct("admin"), keccak256(abi.encode(exaPlugin.pluginMetadata().name, exaPlugin.pluginMetadata().version))
        )
      )
    );
    vm.label(address(exaPlugin), "ExaPlugin");
    vm.label(address(factory), "ExaAccountFactory");
    vm.label(address(factory.ENTRYPOINT()), "EntryPoint");
    vm.label(factory.WEBAUTHN_OWNER_PLUGIN(), "WebauthnOwnerPlugin");
    vm.label(factory.IMPL(), "ModularAccount");

    bob = vm.addr(bobKey);
    vm.label(bob, "bob");

    domainSeparator = issuerChecker.DOMAIN_SEPARATOR();
  }

  function run() external {
    address[] memory owners = new address[](1);
    owners[0] = bob;

    uint256 maturity = block.timestamp + FixedLib.INTERVAL - (block.timestamp % FixedLib.INTERVAL);

    uint256[] memory amounts = new uint256[](4);
    amounts[0] = 13e6;
    amounts[1] = 12e6;
    amounts[2] = 11e6;
    amounts[3] = 10e6;

    vm.startBroadcast(acct("keeper"));
    bobAccount = IExaAccount(factory.createAccount(0, owners.toPublicKeys()));
    vm.label(address(bobAccount), "bobAccount");
    _deal(address(bob), 1 ether);
    _deal(address(bobAccount), 1 ether);
    exa.mint(address(bobAccount), 666e18);
    usdc.mint(address(bobAccount), 69_420e6);
    bobAccount.poke(exaEXA);
    bobAccount.poke(exaUSDC);
    bobAccount.pokeETH();
    bobAccount.collectDebit(666e6, block.timestamp, _issuerOp(666e6, block.timestamp));
    bobAccount.collectCredit(maturity, 420e6, block.timestamp, _issuerOp(420e6, block.timestamp));
    bobAccount.collectCredit(maturity + FixedLib.INTERVAL, 69e6, block.timestamp, _issuerOp(69e6, block.timestamp));
    bobAccount.collectInstallments(
      maturity, amounts, type(uint256).max, block.timestamp, _issuerOp(46e6, block.timestamp)
    );
    for (uint256 i = 0; i < 16; i++) {
      usdc.mint(address(0x1), 1);
    }
    usdc.mint(address(bobAccount), 1e6);
    bobAccount.poke(exaUSDC);
    usdc.mint(address(bobAccount), 1e6);
    bobAccount.poke(exaUSDC);
    usdc.mint(address(bobAccount), 1e6);
    bobAccount.poke(exaUSDC);

    vm.stopBroadcast();
    Call[] memory calls = new Call[](6);
    calls[0] = Call(
      address(bobAccount),
      0,
      abi.encodeCall(
        IExaAccount.propose,
        (
          exaUSDC,
          420e6,
          ProposalType.REPAY_AT_MATURITY,
          abi.encode(RepayData({ maturity: maturity, positionAssets: 420e6 }))
        )
      )
    );
    calls[1] = Call(
      address(bobAccount),
      0,
      abi.encodeCall(
        IExaAccount.propose,
        (
          exaEXA,
          100e18,
          ProposalType.CROSS_REPAY_AT_MATURITY,
          abi.encode(
            CrossRepayData({
              maturity: maturity + FixedLib.INTERVAL,
              positionAssets: 82e6,
              maxRepay: 82e6,
              route: abi.encodeCall(
                MockSwapper.swapExactAmountOut, (address(exa), 100e18, address(usdc), 82e6, address(bobAccount))
              )
            })
          )
        )
      )
    );
    calls[2] = Call(
      address(bobAccount),
      0,
      abi.encodeCall(IExaAccount.propose, (exaUSDC, 69e6, ProposalType.WITHDRAW, abi.encode(address(0x69))))
    );
    calls[3] = Call(
      address(bobAccount),
      0,
      abi.encodeCall(IExaAccount.propose, (exaWETH, 0.01 ether, ProposalType.WITHDRAW, abi.encode(address(0x69))))
    );
    calls[4] = Call(
      address(bobAccount),
      0,
      abi.encodeCall(
        IExaAccount.propose,
        (
          exaUSDC,
          100e6,
          ProposalType.BORROW_AT_MATURITY,
          abi.encode(
            BorrowAtMaturityData({ maturity: maturity + FixedLib.INTERVAL, maxAssets: 110e6, receiver: address(0x69) })
          )
        )
      )
    );
    calls[5] = Call(
      address(bobAccount),
      0,
      abi.encodeCall(
        IExaAccount.propose,
        (
          exaEXA,
          100e18,
          ProposalType.SWAP,
          abi.encode(
            SwapData({
              assetOut: IERC20(address(usdc)),
              minAmountOut: 1,
              route: abi.encodeCall(
                MockSwapper.swapExactAmountOut, (address(exa), 100e18, address(usdc), 82e6, address(bobAccount))
              )
            })
          )
        )
      )
    );
    vm.broadcast(bob);
    IStandardExecutor(address(bobAccount)).executeBatch(calls);
  }

  function _deal(address account, uint256 amount) internal {
    vm.deal(account, amount);
    if (block.chainid == getChain("anvil").chainId) {
      try vm.activeFork() {
        vm.rpc(
          "anvil_setBalance",
          string.concat('["', account.toHexString(), '","', amount.toHexString(), '"]') // solhint-disable-line quotes
        );
      } catch { } // solhint-disable-line no-empty-blocks
    }
  }

  function _issuerOp(uint256 amount, uint256 timestamp) internal view returns (bytes memory signature) {
    return _sign(
      0x420,
      keccak256(
        abi.encodePacked(
          "\x19\x01",
          domainSeparator,
          keccak256(
            abi.encode(
              keccak256("Collection(address account,uint256 amount,uint40 timestamp)"), bobAccount, amount, timestamp
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

  error DepositsNotEqual();
  error BelowMinimumK();
  error FactoryAlreadySet();
  error InsufficientLiquidity();
  error InsufficientLiquidityMinted();
  error InsufficientLiquidityBurned();
  error InsufficientOutputAmount();
  error InsufficientInputAmount();
  error IsPaused();
  error InvalidTo();
  error K();
  error NotEmergencyCouncil();
}
