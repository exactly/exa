// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import { AccessControl } from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { IERC4626 } from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";

import { SafeERC20 } from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "openzeppelin-contracts/contracts/utils/Address.sol";

import {
  ManifestAssociatedFunction,
  ManifestAssociatedFunctionType,
  ManifestExecutionHook,
  ManifestFunction,
  PluginManifest,
  PluginMetadata
} from "modular-account-libs/interfaces/IPlugin.sol";
import { IPluginExecutor } from "modular-account-libs/interfaces/IPluginExecutor.sol";
import { FunctionReference, IPluginManager } from "modular-account-libs/interfaces/IPluginManager.sol";
import { Call, IStandardExecutor } from "modular-account-libs/interfaces/IStandardExecutor.sol";
import { BasePlugin } from "modular-account-libs/plugins/BasePlugin.sol";

import { WETH as IWETH } from "solady/tokens/WETH.sol";
import { ECDSA } from "solady/utils/ECDSA.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { LibBytes } from "solady/utils/LibBytes.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { SafeCastLib } from "solady/utils/SafeCastLib.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

import { CrossRepayCallbackData, ExaPluginExtension, RepayCallbackData } from "./ExaPluginExtension.sol";
import {
  BorrowAtMaturityData,
  CollectorSet,
  CrossRepayData,
  Disagreement,
  ExtensionFailed,
  FlashLoanerSet,
  IAuditor,
  IDebtManager,
  IExaAccount,
  IFlashLoaner,
  IInstallmentsRouter,
  IMarket,
  IProposalManager,
  NoBalance,
  NotMarket,
  NotNext,
  PendingProposals,
  PluginAllowed,
  Proposal,
  ProposalManagerSet,
  ProposalType,
  RepayData,
  RollDebtData,
  SwapData,
  SwapperSet,
  Timelocked,
  Unauthorized,
  ZeroAddress
} from "./IExaAccount.sol";
import { IssuerChecker } from "./IssuerChecker.sol";

/// @title Exa Plugin
/// @author Exactly
contract ExaPlugin is AccessControl, BasePlugin, IExaAccount, ReentrancyGuard {
  using FixedPointMathLib for uint256;
  using SafeTransferLib for address;
  using SafeCastLib for int256;
  using SafeERC20 for IERC20;
  using Address for address;
  using LibBytes for bytes;
  using ECDSA for bytes32;

  string private constant NAME = "Exa Plugin";
  string private constant VERSION = "1.0.0";
  string private constant AUTHOR = "Exactly";

  bytes32 private constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

  IAuditor public immutable AUDITOR;
  IMarket public immutable EXA_USDC;
  IMarket public immutable EXA_WETH;
  IDebtManager public immutable DEBT_MANAGER;
  IInstallmentsRouter public immutable INSTALLMENTS_ROUTER;
  IssuerChecker public immutable ISSUER_CHECKER;
  ExaPluginExtension public immutable EXTENSION;

  IERC20 private immutable USDC;
  IWETH private immutable WETH;

  IFlashLoaner public flashLoaner;
  IProposalManager public proposalManager;
  address public swapper;
  address public collector;
  mapping(address plugin => bool allowed) public allowlist;

  bytes32 public callHash;
  bytes32 private flashLoaning;
  address private uninstalling;

  constructor(Parameters memory p) {
    USDC = IERC20(p.exaUSDC.asset());
    WETH = IWETH(payable(p.exaWETH.asset()));
    AUDITOR = p.auditor;
    EXA_USDC = p.exaUSDC;
    EXA_WETH = p.exaWETH;
    DEBT_MANAGER = p.debtManager;
    INSTALLMENTS_ROUTER = p.installmentsRouter;
    ISSUER_CHECKER = p.issuerChecker;
    EXTENSION = new ExaPluginExtension(EXA_USDC, EXA_WETH);

    _grantRole(KEEPER_ROLE, p.firstKeeper);
    _grantRole(DEFAULT_ADMIN_ROLE, p.owner);
    _setFlashLoaner(p.flashLoaner);
    _setSwapper(p.swapper);
    _setCollector(p.collector);
    _setProposalManager(p.proposalManager);

    USDC.forceApprove(address(EXA_USDC), type(uint256).max);
  }

  // slither-disable-next-line calls-loop
  function swap(IERC20 assetIn, IERC20 assetOut, uint256 maxAmountIn, uint256 minAmountOut, bytes memory route)
    public
    nonReentrant
    returns (uint256 amountIn, uint256 amountOut)
  {
    if (_isMarket(IMarket(address(assetIn)))) revert Unauthorized();

    uint256 balanceIn = assetIn.balanceOf(msg.sender);
    uint256 balanceOut = assetOut.balanceOf(msg.sender);
    address _swapper = swapper;

    _approveAndExecuteFromSender(_swapper, address(assetIn), maxAmountIn, route);

    amountOut = assetOut.balanceOf(msg.sender) - balanceOut;
    if (amountOut < minAmountOut) revert Disagreement();

    _approveFromSender(address(assetIn), _swapper, 0);
    amountIn = balanceIn - assetIn.balanceOf(msg.sender);
  }

  function executeProposal(uint256 nonce) public {
    IProposalManager _proposalManager = proposalManager;
    // slither-disable-next-line calls-loop
    (uint256 nextNonce, Proposal memory proposal) = _proposalManager.nextProposal(msg.sender);
    if (nonce != nextNonce) revert NotNext();

    // slither-disable-next-line calls-loop
    if (proposal.timestamp + _proposalManager.delay() > block.timestamp) revert Timelocked();

    if (proposal.proposalType == ProposalType.WITHDRAW || proposal.proposalType == ProposalType.REDEEM) {
      _withdraw(proposal);
    } else if (proposal.proposalType == ProposalType.SWAP) {
      _swap(proposal);
    } else if (proposal.proposalType == ProposalType.BORROW_AT_MATURITY) {
      _borrowAtMaturity(proposal);
    } else if (proposal.proposalType == ProposalType.CROSS_REPAY_AT_MATURITY) {
      _crossRepay(proposal);
    } else if (proposal.proposalType == ProposalType.ROLL_DEBT) {
      _rollDebt(proposal);
    } else if (proposal.proposalType == ProposalType.REPAY_AT_MATURITY) {
      _repay(proposal);
    }
  }

  function executeProposals(uint256 firstNonce, uint256 count) external {
    for (uint256 i = 0; i < count; ++i) {
      executeProposal(firstNonce + i);
    }
  }

  function propose(IMarket market, uint256 amount, ProposalType proposalType, bytes memory data) external {
    _propose(market, amount, proposalType, data);
  }

  function setProposalNonce(uint256 nonce) external {
    proposalManager.setNonce(msg.sender, nonce);
  }

  function proposeRepay(IMarket market, uint256 amount, ProposalType proposalType, bytes memory data) external {
    if (
      proposalType != ProposalType.CROSS_REPAY_AT_MATURITY && proposalType != ProposalType.REPAY_AT_MATURITY
        && proposalType != ProposalType.ROLL_DEBT
    ) revert Unauthorized();
    _propose(market, amount, proposalType, data);
  }

  function collectCollateral(
    uint256 amount,
    IMarket collateral,
    uint256 maxAmountIn,
    uint256 timestamp,
    bytes calldata route,
    bytes calldata signature
  ) external returns (uint256 amountIn, uint256 amountOut) {
    _checkIssuer(msg.sender, amount, timestamp, signature);
    _checkMarket(collateral);

    // slither-disable-next-line reentrancy-benign -- issuer checker is safe
    callHash = keccak256(abi.encode(collateral, IERC4626.withdraw.selector, maxAmountIn, address(this), msg.sender))
      & ~bytes32(uint256(1));
    _withdrawFromSender(collateral, maxAmountIn, address(this));
    // slither-disable-next-line reentrancy-benign -- markets are safe
    delete callHash;
    (amountIn, amountOut) = _swap(IERC20(collateral.asset()), IERC20(USDC), maxAmountIn, amount, route);
    IERC20(USDC).safeTransfer(collector, amount);

    uint256 unspentCollateral = maxAmountIn - amountIn;
    if (unspentCollateral != 0) {
      if (_checkDeposit(collateral, unspentCollateral)) {
        _depositUnspent(collateral, unspentCollateral, msg.sender);
      } else {
        IERC20(collateral.asset()).safeTransfer(msg.sender, unspentCollateral);
      }
    }
    uint256 unspent = amountOut - amount;
    if (_checkDeposit(EXA_USDC, unspent)) {
      EXA_USDC.deposit(unspent, msg.sender);
      _executeFromSender(address(AUDITOR), 0, abi.encodeCall(IAuditor.enterMarket, (EXA_USDC)));
    }
  }

  function collectCredit(uint256 maturity, uint256 amount, uint256 timestamp, bytes calldata signature) external {
    collectCredit(maturity, amount, type(uint256).max, timestamp, signature);
  }

  function collectCredit(
    uint256 maturity,
    uint256 amount,
    uint256 maxRepay,
    uint256 timestamp,
    bytes calldata signature
  ) public {
    _checkIssuer(msg.sender, amount, timestamp, signature);

    _executeFromSender(
      address(EXA_USDC),
      0,
      abi.encodeCall(IMarket.borrowAtMaturity, (maturity, amount, maxRepay, collector, msg.sender))
    );
  }

  function collectDebit(uint256 amount, uint256 timestamp, bytes calldata signature) external {
    _checkIssuer(msg.sender, amount, timestamp, signature);
    _withdrawFromSender(EXA_USDC, amount, collector);
  }

  function collectInstallments(
    uint256 firstMaturity,
    uint256[] calldata amounts,
    uint256 maxRepay,
    uint256 timestamp,
    bytes calldata signature
  ) external {
    uint256 totalAmount = 0;
    for (uint256 i = 0; i < amounts.length; ++i) {
      totalAmount += amounts[i];
    }
    _checkIssuer(msg.sender, totalAmount, timestamp, signature);

    _approveAndExecuteFromSender(
      address(INSTALLMENTS_ROUTER),
      address(EXA_USDC),
      maxRepay,
      abi.encodeCall(IInstallmentsRouter.borrow, (EXA_USDC, firstMaturity, amounts, maxRepay, collector))
    );
    _approveFromSender(address(EXA_USDC), address(INSTALLMENTS_ROUTER), 0);
  }

  function poke(IMarket market) external {
    _checkMarket(market);
    _poke(market);
  }

  function pokeETH() external {
    _executeFromSender(address(WETH), msg.sender.balance, abi.encodeCall(IWETH.deposit, ()));
    _poke(EXA_WETH);
  }

  function receiveFlashLoan(IERC20[] calldata, uint256[] calldata, uint256[] calldata, bytes calldata) external {
    // solhint-disable avoid-low-level-calls
    // slither-disable-next-line controlled-delegatecall,low-level-calls -- extension is safe
    (bool success, bytes memory returnData) = address(EXTENSION).delegatecall(msg.data);
    // solhint-enable avoid-low-level-calls
    if (!success) {
      if (returnData.length == 0) revert ExtensionFailed();
      // solhint-disable no-inline-assembly
      // slither-disable-next-line assembly
      assembly ("memory-safe") {
        // solhint-enable no-inline-assembly
        revert(add(32, returnData), mload(returnData))
      }
    }
  }

  receive() external payable { } // solhint-disable-line no-empty-blocks

  function setFlashLoaner(IFlashLoaner flashLoaner_) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _setFlashLoaner(flashLoaner_);
  }

  function setCollector(address collector_) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _setCollector(collector_);
  }

  function setProposalManager(IProposalManager proposalManager_) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _setProposalManager(proposalManager_);
  }

  function setSwapper(address swapper_) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _setSwapper(swapper_);
  }

  function allowPlugin(address plugin, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
    if (plugin == address(0)) revert ZeroAddress();
    allowlist[plugin] = allowed;
    emit PluginAllowed(plugin, msg.sender, allowed);
  }

  /// @inheritdoc BasePlugin
  function onInstall(bytes calldata) external override { } // solhint-disable-line no-empty-blocks

  /// @inheritdoc BasePlugin
  function onUninstall(bytes calldata) external override { } // solhint-disable-line no-empty-blocks

  /// @inheritdoc BasePlugin
  function pluginManifest() external pure override returns (PluginManifest memory manifest) {
    bytes4[] memory executionFunctions = new bytes4[](13);
    executionFunctions[0] = this.swap.selector;
    executionFunctions[1] = this.propose.selector;
    executionFunctions[2] = this.executeProposal.selector;
    executionFunctions[3] = this.executeProposals.selector;
    executionFunctions[4] = this.setProposalNonce.selector;
    executionFunctions[5] = this.proposeRepay.selector;
    executionFunctions[6] = this.collectCollateral.selector;
    executionFunctions[7] = bytes4(keccak256("collectCredit(uint256,uint256,uint256,bytes)"));
    executionFunctions[8] = bytes4(keccak256("collectCredit(uint256,uint256,uint256,uint256,bytes)"));
    executionFunctions[9] = this.collectDebit.selector;
    executionFunctions[10] = this.collectInstallments.selector;
    executionFunctions[11] = this.poke.selector;
    executionFunctions[12] = this.pokeETH.selector;
    manifest.executionFunctions = executionFunctions;

    ManifestFunction memory selfRuntimeValidationFunction = ManifestFunction({
      functionType: ManifestAssociatedFunctionType.SELF,
      functionId: uint8(FunctionId.RUNTIME_VALIDATION_SELF),
      dependencyIndex: 0
    });
    ManifestFunction memory keeperRuntimeValidationFunction = ManifestFunction({
      functionType: ManifestAssociatedFunctionType.SELF,
      functionId: uint8(FunctionId.RUNTIME_VALIDATION_KEEPER),
      dependencyIndex: 0
    });
    ManifestFunction memory keeperOrSelfRuntimeValidationFunction = ManifestFunction({
      functionType: ManifestAssociatedFunctionType.SELF,
      functionId: uint8(FunctionId.RUNTIME_VALIDATION_KEEPER_OR_SELF),
      dependencyIndex: 0
    });

    ManifestAssociatedFunction[] memory runtimeValidationFunctions = new ManifestAssociatedFunction[](13);
    runtimeValidationFunctions[0] = ManifestAssociatedFunction({
      executionSelector: IExaAccount.swap.selector,
      associatedFunction: selfRuntimeValidationFunction
    });
    runtimeValidationFunctions[1] = ManifestAssociatedFunction({
      executionSelector: IExaAccount.propose.selector,
      associatedFunction: selfRuntimeValidationFunction
    });
    runtimeValidationFunctions[2] = ManifestAssociatedFunction({
      executionSelector: IExaAccount.executeProposal.selector,
      associatedFunction: keeperOrSelfRuntimeValidationFunction
    });
    runtimeValidationFunctions[3] = ManifestAssociatedFunction({
      executionSelector: IExaAccount.executeProposals.selector,
      associatedFunction: keeperOrSelfRuntimeValidationFunction
    });
    runtimeValidationFunctions[4] = ManifestAssociatedFunction({
      executionSelector: IExaAccount.setProposalNonce.selector,
      associatedFunction: keeperOrSelfRuntimeValidationFunction
    });
    runtimeValidationFunctions[5] = ManifestAssociatedFunction({
      executionSelector: IExaAccount.proposeRepay.selector,
      associatedFunction: keeperRuntimeValidationFunction
    });
    runtimeValidationFunctions[6] = ManifestAssociatedFunction({
      executionSelector: IExaAccount.collectCollateral.selector,
      associatedFunction: keeperRuntimeValidationFunction
    });
    runtimeValidationFunctions[7] = ManifestAssociatedFunction({
      executionSelector: bytes4(keccak256("collectCredit(uint256,uint256,uint256,bytes)")),
      associatedFunction: keeperRuntimeValidationFunction
    });
    runtimeValidationFunctions[8] = ManifestAssociatedFunction({
      executionSelector: bytes4(keccak256("collectCredit(uint256,uint256,uint256,uint256,bytes)")),
      associatedFunction: keeperRuntimeValidationFunction
    });
    runtimeValidationFunctions[9] = ManifestAssociatedFunction({
      executionSelector: IExaAccount.collectDebit.selector,
      associatedFunction: keeperRuntimeValidationFunction
    });
    runtimeValidationFunctions[10] = ManifestAssociatedFunction({
      executionSelector: IExaAccount.collectInstallments.selector,
      associatedFunction: keeperRuntimeValidationFunction
    });
    runtimeValidationFunctions[11] = ManifestAssociatedFunction({
      executionSelector: IExaAccount.poke.selector,
      associatedFunction: keeperRuntimeValidationFunction
    });
    runtimeValidationFunctions[12] = ManifestAssociatedFunction({
      executionSelector: IExaAccount.pokeETH.selector,
      associatedFunction: keeperRuntimeValidationFunction
    });
    manifest.runtimeValidationFunctions = runtimeValidationFunctions;

    ManifestFunction memory singleExecutionHook = ManifestFunction({
      functionType: ManifestAssociatedFunctionType.SELF,
      functionId: uint8(FunctionId.EXECUTION_HOOK_SINGLE),
      dependencyIndex: 0
    });
    ManifestFunction memory batchExecutionHook = ManifestFunction({
      functionType: ManifestAssociatedFunctionType.SELF,
      functionId: uint8(FunctionId.EXECUTION_HOOK_BATCH),
      dependencyIndex: 0
    });
    ManifestFunction memory uninstallExecutionHook = ManifestFunction({
      functionType: ManifestAssociatedFunctionType.SELF,
      functionId: uint8(FunctionId.EXECUTION_HOOK_UNINSTALL),
      dependencyIndex: 0
    });
    ManifestFunction memory none =
      ManifestFunction({ functionType: ManifestAssociatedFunctionType.NONE, functionId: 0, dependencyIndex: 0 });

    ManifestExecutionHook[] memory executionHooks = new ManifestExecutionHook[](4);
    executionHooks[0] = ManifestExecutionHook({
      executionSelector: IStandardExecutor.execute.selector,
      preExecHook: singleExecutionHook,
      postExecHook: none
    });
    executionHooks[1] = ManifestExecutionHook({
      executionSelector: IStandardExecutor.executeBatch.selector,
      preExecHook: batchExecutionHook,
      postExecHook: none
    });
    executionHooks[2] = ManifestExecutionHook({
      executionSelector: IPluginExecutor.executeFromPluginExternal.selector,
      preExecHook: singleExecutionHook,
      postExecHook: none
    });
    executionHooks[3] = ManifestExecutionHook({
      executionSelector: IPluginManager.uninstallPlugin.selector,
      preExecHook: uninstallExecutionHook,
      postExecHook: none
    });
    manifest.executionHooks = executionHooks;

    manifest.preUserOpValidationHooks = new ManifestAssociatedFunction[](executionFunctions.length);
    for (uint256 i = 0; i < executionFunctions.length; ++i) {
      manifest.preUserOpValidationHooks[i] = ManifestAssociatedFunction({
        executionSelector: executionFunctions[i],
        associatedFunction: ManifestFunction({
          functionType: ManifestAssociatedFunctionType.PRE_HOOK_ALWAYS_DENY,
          functionId: 0,
          dependencyIndex: 0
        })
      });
    }

    manifest.permitAnyExternalAddress = true;
    manifest.canSpendNativeToken = true;

    return manifest;
  }

  /// @inheritdoc BasePlugin
  function pluginMetadata() external pure virtual override returns (PluginMetadata memory metadata) {
    metadata.name = NAME;
    metadata.version = VERSION;
    metadata.author = AUTHOR;
  }

  /// @inheritdoc BasePlugin
  function preExecutionHook(uint8 functionId, address, uint256, bytes calldata callData)
    external
    override
    returns (bytes memory)
  {
    if (functionId == uint8(FunctionId.EXECUTION_HOOK_BATCH)) {
      _checkBatch(abi.decode(callData[4:], (Call[])));
      return "";
    }
    if (functionId == uint8(FunctionId.EXECUTION_HOOK_SINGLE)) {
      address target = address(bytes20(callData[16:36]));
      bytes4 selector = bytes4(callData[132:136]);
      bytes memory data = callData[136:];
      if (target == msg.sender) {
        if (selector == IPluginManager.uninstallPlugin.selector && _willUninstallThis(data)) revert Unauthorized();
        return "";
      }
      _preExecutionChecker(target, selector, data);
      return "";
    }
    if (functionId == uint8(FunctionId.EXECUTION_HOOK_UNINSTALL)) {
      if (_willUninstallThis(callData[4:]) && uninstalling != msg.sender) revert Unauthorized();
      delete uninstalling;
      return "";
    }
    revert NotImplemented(msg.sig, functionId);
  }

  function _checkBatch(Call[] memory calls) internal {
    for (uint256 i = 0; i < calls.length; ++i) {
      Call memory call = calls[i];
      bytes4 selector = bytes4(call.data.slice(0, 4));
      bytes memory data = call.data.slice(4, call.data.length);
      if (call.target == msg.sender) {
        if (selector == IPluginManager.uninstallPlugin.selector && _willUninstallThis(data)) {
          if (
            i == calls.length - 1 || bytes4(calls[i + 1].data.slice(0, 4)) != IPluginManager.installPlugin.selector
              || calls[i + 1].target != msg.sender
          ) revert Unauthorized();
          bytes memory nextCallData = calls[i + 1].data.slice(4, calls[i + 1].data.length);
          (address newPlugin,,,) = abi.decode(nextCallData, (address, bytes32, bytes, FunctionReference[]));
          if (!allowlist[newPlugin]) revert Unauthorized();
          // slither-disable-next-line calls-loop -- should deny service on revert
          try this.hasPendingProposals(msg.sender) returns (bool pending) {
            if (pending) revert PendingProposals();
          } catch { } // solhint-disable-line no-empty-blocks
          uninstalling = msg.sender;
        }
        continue;
      }
      // slither-disable-next-line reentrancy-benign -- proposal manager is safe
      _preExecutionChecker(call.target, selector, data);
    }
  }

  function _checkDeposit(IMarket market, uint256 amount) internal view returns (bool) {
    return market.previewDeposit(amount) != 0 && !market.isFrozen();
  }

  function hasPendingProposals(address account) external view returns (bool) {
    IProposalManager _proposalManager = proposalManager;
    return _proposalManager.nonces(account) != _proposalManager.queueNonces(account);
  }

  function _preExecutionChecker(address target, bytes4 selector, bytes memory callData) internal {
    // slither-disable-next-line calls-loop -- should deny service on revert
    proposalManager.preExecutionChecker(msg.sender, target, selector, callData);
  }

  /// @inheritdoc BasePlugin
  function runtimeValidationFunction(uint8 functionId, address sender, uint256, bytes calldata) external view override {
    if (functionId == uint8(FunctionId.RUNTIME_VALIDATION_SELF)) {
      if (msg.sender != sender) revert Unauthorized();
      return;
    }
    if (functionId == uint8(FunctionId.RUNTIME_VALIDATION_KEEPER)) {
      if (!hasRole(KEEPER_ROLE, sender)) revert Unauthorized();
      return;
    }
    if (functionId == uint8(FunctionId.RUNTIME_VALIDATION_KEEPER_OR_SELF)) {
      if (hasRole(KEEPER_ROLE, sender) || msg.sender == sender) return;
      revert Unauthorized();
    }
    revert NotImplemented(msg.sig, functionId);
  }

  function _approve(address account, address asset, address spender, uint256 amount) internal {
    _execute(account, asset, 0, abi.encodeCall(IERC20.approve, (spender, amount)));
  }

  function _approveFromSender(address asset, address spender, uint256 amount) internal {
    _approve(msg.sender, asset, spender, amount);
  }

  function _approveAndExecuteFromSender(address target, address asset, uint256 amount, bytes memory data) internal {
    _approve(msg.sender, asset, target, amount);
    _execute(msg.sender, target, 0, data);
  }

  function _borrowAtMaturity(Proposal memory proposal) internal {
    BorrowAtMaturityData memory borrowData = abi.decode(proposal.data, (BorrowAtMaturityData));
    _executeFromSender(
      address(proposal.market),
      0,
      abi.encodeCall(
        IMarket.borrowAtMaturity,
        (borrowData.maturity, proposal.amount, borrowData.maxAssets, borrowData.receiver, msg.sender)
      )
    );
  }

  function _checkIssuer(address issuer, uint256 amount, uint256 timestamp, bytes calldata signature) internal {
    ISSUER_CHECKER.checkIssuer(issuer, amount, timestamp, signature);
  }

  function _checkMarket(IMarket market) internal view {
    if (!_isMarket(market)) revert NotMarket();
  }

  function _crossRepay(Proposal memory proposal) internal {
    CrossRepayData memory crossData = abi.decode(proposal.data, (CrossRepayData));
    bytes memory data = _hash(
      abi.encodePacked(
        bytes1(0x02),
        abi.encode(
          CrossRepayCallbackData({
            maturity: crossData.maturity,
            borrower: msg.sender,
            positionAssets: crossData.positionAssets,
            maxRepay: crossData.maxRepay,
            marketIn: proposal.market,
            marketOut: crossData.marketOut,
            maxAmountIn: proposal.amount,
            route: crossData.route
          })
        )
      )
    );
    // slither-disable-next-line calls-loop
    _flashLoan(crossData.maxRepay, IERC20(crossData.marketOut.asset()), data);
  }

  function _execute(address account, address target, uint256 value, bytes memory data) internal {
    // slither-disable-next-line calls-loop
    IPluginExecutor(account).executeFromPluginExternal(target, value, data);
  }

  function _executeFromSender(address target, uint256 value, bytes memory data) internal {
    _execute(msg.sender, target, value, data);
  }

  function _flashLoan(uint256 amount, IERC20 token, bytes memory data) internal {
    IERC20[] memory tokens = new IERC20[](1);
    tokens[0] = token;
    uint256[] memory amounts = new uint256[](1);
    amounts[0] = amount;

    // slither-disable-next-line calls-loop
    flashLoaner.flashLoan(address(this), tokens, amounts, data);
  }

  function _depositUnspent(IMarket market, uint256 unspent, address receiver) internal {
    if (market != EXA_USDC) IERC20(market.asset()).forceApprove(address(market), unspent);
    market.deposit(unspent, receiver);
  }

  function _hash(bytes memory data) internal returns (bytes memory) {
    // slither-disable-next-line costly-loop
    flashLoaning = keccak256(data);
    return data;
  }

  function _isMarket(IMarket market) internal view returns (bool) {
    // slither-disable-next-line calls-loop
    return AUDITOR.markets(market).isListed;
  }

  function _poke(IMarket market) internal {
    uint256 balance = IERC20(market.asset()).balanceOf(msg.sender);
    // slither-disable-next-line incorrect-equality -- unsigned zero check
    if (balance == 0) revert NoBalance();

    _approveAndExecuteFromSender(
      address(market), market.asset(), balance, abi.encodeCall(IERC4626.deposit, (balance, msg.sender))
    );
    _executeFromSender(address(AUDITOR), 0, abi.encodeCall(IAuditor.enterMarket, (market)));
  }

  function _propose(IMarket market, uint256 amount, ProposalType proposalType, bytes memory data) internal {
    proposalManager.propose(msg.sender, market, amount, proposalType, data);
  }

  function _repay(Proposal memory proposal) internal {
    RepayData memory repayData = abi.decode(proposal.data, (RepayData));
    bytes memory data = _hash(
      abi.encodePacked(
        bytes1(0x01),
        abi.encode(
          RepayCallbackData({
            maturity: repayData.maturity,
            borrower: msg.sender,
            positionAssets: repayData.positionAssets,
            maxRepay: proposal.amount
          })
        )
      )
    );
    _flashLoan(proposal.amount, USDC, data);
  }

  function _rollDebt(Proposal memory proposal) internal {
    RollDebtData memory rollData = abi.decode(proposal.data, (RollDebtData));
    _approveAndExecuteFromSender(
      address(DEBT_MANAGER),
      address(EXA_USDC),
      rollData.maxRepayAssets,
      abi.encodeCall(
        IDebtManager.rollFixed,
        (
          EXA_USDC,
          rollData.repayMaturity,
          rollData.borrowMaturity,
          rollData.maxRepayAssets,
          proposal.amount,
          rollData.percentage
        )
      )
    );
    _approveFromSender(address(EXA_USDC), address(DEBT_MANAGER), 0);
  }

  function _setFlashLoaner(IFlashLoaner flashLoaner_) internal {
    if (address(flashLoaner_) == address(0)) revert ZeroAddress();
    flashLoaner = flashLoaner_;
    emit FlashLoanerSet(msg.sender, flashLoaner_);
  }

  function _setCollector(address collector_) internal {
    if (collector_ == address(0)) revert ZeroAddress();
    collector = collector_;
    emit CollectorSet(collector_, msg.sender);
  }

  function _setProposalManager(IProposalManager proposalManager_) internal {
    if (address(proposalManager_) == address(0)) revert ZeroAddress();
    proposalManager = proposalManager_;
    emit ProposalManagerSet(proposalManager_, msg.sender);
  }

  function _setSwapper(address swapper_) internal {
    if (swapper_ == address(0)) revert ZeroAddress();
    swapper = swapper_;
    emit SwapperSet(swapper_, msg.sender);
  }

  function _swap(Proposal memory proposal) internal {
    _withdrawFromSender(proposal.market, proposal.amount, msg.sender);
    SwapData memory data = abi.decode(proposal.data, (SwapData));
    // slither-disable-next-line calls-loop
    swap(IERC20(proposal.market.asset()), data.assetOut, proposal.amount, data.minAmountOut, data.route);
  }

  function _swap(IERC20 assetIn, IERC20 assetOut, uint256 maxAmountIn, uint256 minAmountOut, bytes memory route)
    internal
    nonReentrant
    returns (uint256 amountIn, uint256 amountOut)
  {
    address _swapper = swapper;
    uint256 balanceIn = assetIn.balanceOf(address(this));
    uint256 balanceOut = assetOut.balanceOf(address(this));

    assetIn.forceApprove(_swapper, maxAmountIn);
    _swapper.functionCall(route);

    amountOut = assetOut.balanceOf(address(this)) - balanceOut;
    if (minAmountOut > amountOut) revert Disagreement();

    assetIn.forceApprove(_swapper, 0);
    amountIn = balanceIn - assetIn.balanceOf(address(this));
  }

  function _willUninstallThis(bytes memory data) internal view returns (bool) {
    (address plugin,,) = abi.decode(data, (address, bytes, bytes));
    return plugin == address(this);
  }

  function _withdrawFromSender(IMarket market, uint256 amount, address receiver) internal {
    _executeFromSender(address(market), 0, abi.encodeCall(IERC4626.withdraw, (amount, receiver, msg.sender)));
  }

  function _withdraw(Proposal memory proposal) internal {
    address receiver = abi.decode(proposal.data, (address));
    bool isWETH = proposal.market == EXA_WETH;
    if (isWETH) {
      // slither-disable-next-line costly-loop
      callHash = keccak256(
        abi.encode(
          proposal.market,
          proposal.proposalType == ProposalType.REDEEM ? IERC4626.redeem.selector : IERC4626.withdraw.selector,
          proposal.amount,
          address(this),
          msg.sender
        )
      ) | bytes32(uint256(1));
    }

    uint256 assets = 0;
    if (proposal.proposalType == ProposalType.REDEEM) {
      // slither-disable-next-line calls-loop
      assets = abi.decode(
        IPluginExecutor(msg.sender).executeFromPluginExternal(
          address(proposal.market),
          0,
          abi.encodeCall(IERC4626.redeem, (proposal.amount, isWETH ? address(this) : receiver, msg.sender))
        ),
        (uint256)
      );
    } else {
      assets = proposal.amount;
      _withdrawFromSender(proposal.market, assets, isWETH ? address(this) : receiver);
    }

    if (isWETH) {
      // slither-disable-next-line reentrancy-benign,costly-loop -- markets are safe
      delete callHash;
      // slither-disable-next-line calls-loop
      WETH.withdraw(assets);
      receiver.safeTransferETH(assets);
    }
  }

  function supportsInterface(bytes4 interfaceId) public view override(AccessControl, BasePlugin) returns (bool) {
    return interfaceId == type(IExaAccount).interfaceId || super.supportsInterface(interfaceId);
  }
}

enum FunctionId {
  EXECUTION_HOOK_SINGLE,
  EXECUTION_HOOK_BATCH,
  EXECUTION_HOOK_UNINSTALL,
  RUNTIME_VALIDATION_SELF,
  RUNTIME_VALIDATION_KEEPER,
  RUNTIME_VALIDATION_KEEPER_OR_SELF
}

struct Parameters {
  address owner;
  IAuditor auditor;
  IMarket exaUSDC;
  IMarket exaWETH;
  IFlashLoaner flashLoaner;
  IDebtManager debtManager;
  IInstallmentsRouter installmentsRouter;
  IssuerChecker issuerChecker;
  IProposalManager proposalManager;
  address collector;
  address swapper;
  address firstKeeper;
}
