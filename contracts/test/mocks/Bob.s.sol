// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { Previewer } from "@exactly/protocol/periphery/Previewer.sol";
import { FixedLib } from "@exactly/protocol/utils/FixedLib.sol";

import { Call, IStandardExecutor } from "modular-account-libs/interfaces/IStandardExecutor.sol";

import { LibBytes } from "solady/utils/LibBytes.sol";
import { LibString } from "solady/utils/LibString.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { OwnersLib } from "webauthn-owner-plugin/OwnersLib.sol";

import { BaseScript } from "../../script/Base.s.sol";
import { ExaAccountFactory } from "../../src/ExaAccountFactory.sol";
import { ExaPlugin, Parameters } from "../../src/ExaPlugin.sol";
import { CrossRepayData, IExaAccount, IMarket, ProposalType, RepayData, RollDebtData } from "../../src/IExaAccount.sol";
import { IssuerChecker } from "../../src/IssuerChecker.sol";
import { ProposalManager } from "../../src/ProposalManager.sol";

import { MockSwapper } from "./MockSwapper.sol";

contract BobScript is BaseScript {
  using SafeTransferLib for address;
  using OwnersLib for address[];
  using LibBytes for bytes;
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
      payable(CREATE3_FACTORY.getDeployed(
          acct("admin"), keccak256(abi.encode(exaPlugin.pluginMetadata().name, exaPlugin.pluginMetadata().version))
        ))
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

  function run() external returns (ExaPlugin release) {
    address[] memory owners = new address[](1);
    owners[0] = bob;

    uint256 timestamp = block.timestamp + 1 hours;
    uint256 maturity = timestamp + FixedLib.INTERVAL - (timestamp % FixedLib.INTERVAL);

    uint256[] memory amounts = new uint256[](4);
    amounts[0] = 13e6;
    amounts[1] = 12e6;
    amounts[2] = 11e6;
    amounts[3] = 10e6;

    vm.startBroadcast(acct("keeper"));
    bobAccount = IExaAccount(factory.createAccount(0, owners.toPublicKeys()));
    vm.label(address(bobAccount), "bobAccount");
    address(bob).safeTransferETH(1 ether);
    address(bobAccount).safeTransferETH(1 ether);
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
    vm.stopBroadcast();
    Call[] memory calls = new Call[](5);
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
              marketOut: exaUSDC,
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
          25e6,
          ProposalType.ROLL_DEBT,
          abi.encode(
            RollDebtData({
              repayMaturity: maturity,
              borrowMaturity: maturity + 2 * FixedLib.INTERVAL,
              maxRepayAssets: 20e6,
              percentage: 1e18
            })
          )
        )
      )
    );
    vm.broadcast(bob);
    IStandardExecutor(address(bobAccount)).executeBatch(calls);

    IssuerChecker checker = IssuerChecker(_deploy("IssuerChecker", _arguments("IssuerChecker")));
    ProposalManager manager = ProposalManager(
      _deploy(
        "ProposalManager",
        32 * (8 + vm.split(vm.parseJsonString(_tag("ProposalManager"), ".transactions[0].arguments[5]"), ",").length),
        _arguments("ProposalManager")
      )
    );
    _deploy("Refunder", abi.encode(acct("admin"), exaUSDC, checker, acct("keeper")));
    _deploy("ExaPreviewer", abi.encode(protocol("Auditor"), exaUSDC, manager));
    Parameters memory parameters = abi.decode(_arguments("ExaPlugin"), (Parameters));
    parameters.issuerChecker = checker;
    parameters.proposalManager = manager;
    release = ExaPlugin(payable(_deploy("ExaPlugin", abi.encode(parameters))));

    vm.startBroadcast(acct("admin"));
    ExaAccountFactory(
      payable(CREATE3_FACTORY.deploy(
          keccak256(abi.encode(release.pluginMetadata().name, release.pluginMetadata().version)),
          abi.encodePacked(
            type(ExaAccountFactory).creationCode,
            abi.encode(acct("admin"), factory.WEBAUTHN_OWNER_PLUGIN(), release, factory.IMPL(), factory.ENTRYPOINT())
          )
        ))
    )
    .addStake{ value: 0.1 ether }(
      1 days, 0.1 ether
    );
    manager.grantRole(keccak256("PROPOSER_ROLE"), address(release));
    release.allowPlugin(address(exaPlugin), true);
    vm.stopBroadcast();
  }

  function _deploy(string memory name, bytes memory arguments) internal returns (address) {
    return _deploy(name, arguments.length, arguments);
  }

  function _deploy(string memory name, uint256 length, bytes memory arguments) internal returns (address) {
    bytes memory initCode = vm.parseJsonBytes(_tag(name), ".transactions[0].transaction.input");
    vm.broadcast(acct("deployer"));
    return CREATE3_FACTORY.deploy(
      keccak256(abi.encode(name, "1.0.0")), bytes.concat(initCode.slice(0, initCode.length - length), arguments)
    );
  }

  function _tag(string memory name) internal returns (string memory) {
    string[] memory git = new string[](3);
    git[0] = "git";
    git[1] = "show";
    git[2] = string.concat("@exactly/plugin@1.0.0:contracts/broadcast/", name, ".s.sol/10/run-latest.json");
    return string(vm.ffi(git));
  }

  function _arguments(string memory name) internal view returns (bytes memory) {
    return vm.parseJsonBytes(
        vm.readFile(string.concat("broadcast/", name, ".s.sol/", block.chainid.toString(), "/run-latest.json")),
        ".transactions[0].transaction.input"
      ).slice(vm.getCode(string.concat(name, ".sol:", name)).length);
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
