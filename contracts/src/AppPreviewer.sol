// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { Previewer } from "@exactly/protocol/periphery/Previewer.sol";
import { RatePreviewer } from "@exactly/protocol/periphery/RatePreviewer.sol";
import { IAccountLoupe } from "modular-account-libs/interfaces/IAccountLoupe.sol";
import { LibBytes } from "solady/utils/LibBytes.sol";
import { LibCall } from "solady/utils/LibCall.sol";

import { ExaPlugin } from "./ExaPlugin.sol";
import { IAuditor, IExaAccount, IMarket, IProposalManager } from "./IExaAccount.sol";

contract AppPreviewer {
  // slither-disable-start cyclomatic-complexity
  // solhint-disable-next-line function-max-lines
  function preview(address account, address[] calldata targets, Protocol calldata protocol)
    external
    view
    returns (AccountPreview memory preview_)
  {
    preview_.wallet.timestamp = block.timestamp;
    if (account.code.length != 0) {
      try IAccountLoupe(account).getExecutionFunctionConfig(IExaAccount.propose.selector) returns (
        IAccountLoupe.ExecutionFunctionConfig memory config
      ) {
        if (config.plugin.code.length != 0) {
          try ExaPlugin(payable(config.plugin)).proposalManager() returns (IProposalManager proposalManager) {
            preview_.wallet.proposalManager = ProposalManagerPreview({
              proposalManager: address(proposalManager),
              delay: proposalManager.delay(),
              queueNonce: proposalManager.queueNonces(account),
              nonce: proposalManager.nonces(account)
            });
          } catch { } // solhint-disable-line no-empty-blocks
        }
      } catch { } // solhint-disable-line no-empty-blocks
    }
    if (preview_.wallet.proposalManager.proposalManager != address(0)) {
      IProposalManager proposalManager = IProposalManager(preview_.wallet.proposalManager.proposalManager);
      {
        bool[] memory isAllowed = new bool[](targets.length);
        uint256 count = 0;
        for (uint256 i = 0; i < targets.length; ++i) {
          // slither-disable-next-line calls-loop
          isAllowed[i] = proposalManager.allowlist(targets[i]); // forge-lint: disable-line(calls-loop)
          if (isAllowed[i]) ++count;
        }
        preview_.wallet.allowed = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < targets.length; ++i) {
          if (!isAllowed[i]) continue;
          preview_.wallet.allowed[j] = targets[i];
          ++j;
        }
      }
    }
    if (address(protocol.auditor).code.length == 0 || address(protocol.previewer).code.length == 0) return preview_;
    Previewer.MarketAccount[] memory markets = protocol.previewer.exactly(account);
    preview_.protocol.markets = new MarketPreview[](markets.length);
    // forge-lint: disable-start(calls-loop)
    for (uint256 i = 0; i < markets.length; ++i) {
      IMarket market = IMarket(address(markets[i].market));
      // slither-disable-next-line calls-loop
      bytes memory data =
        LibCall.staticCallContract(address(protocol.auditor), abi.encodeCall(IAuditor.markets, (market)));
      // slither-disable-next-line calls-loop
      preview_.protocol.markets[i] = MarketPreview({
        market: markets[i],
        isFrozen: market.isFrozen(),
        nonCollateral: data.length > 5 * 32 && LibBytes.load(data, 5 * 32) != 0,
        floatingAssetsAverage: market.previewFloatingAssetsAverage()
      });
    }
    // forge-lint: disable-end(calls-loop)
    if (address(protocol.ratePreviewer).code.length == 0) return preview_;
    try protocol.ratePreviewer.snapshot() returns (RatePreviewer.Snapshot[] memory rates) {
      preview_.protocol.rates = rates;
    } catch { } // solhint-disable-line no-empty-blocks
  }
  // slither-disable-end cyclomatic-complexity
}

struct Protocol {
  IAuditor auditor;
  Previewer previewer;
  RatePreviewer ratePreviewer;
}

struct AccountPreview {
  WalletPreview wallet;
  ProtocolPreview protocol;
}

struct WalletPreview {
  uint256 timestamp;
  ProposalManagerPreview proposalManager;
  address[] allowed;
}

struct ProtocolPreview {
  MarketPreview[] markets;
  RatePreviewer.Snapshot[] rates;
}

struct MarketPreview {
  Previewer.MarketAccount market;
  bool isFrozen;
  bool nonCollateral;
  uint256 floatingAssetsAverage;
}

struct ProposalManagerPreview {
  address proposalManager;
  uint256 delay;
  uint256 queueNonce;
  uint256 nonce;
}
