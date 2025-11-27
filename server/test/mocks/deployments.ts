import { foundry } from "viem/chains";
import { inject, vi } from "vitest";

vi.mock("@exactly/common/generated/chain", async (importOriginal) => ({
  ...(await importOriginal()),
  default: { ...foundry, rpcUrls: { ...foundry.rpcUrls, alchemy: foundry.rpcUrls.default } },
  auditorAddress: inject("Auditor"),
  exaPluginAddress: inject("ExaPlugin"),
  exaPreviewerAddress: inject("ExaPreviewer"),
  firewallAddress: inject("Firewall"),
  issuerCheckerAddress: inject("IssuerChecker"),
  marketUSDCAddress: inject("MarketUSDC"),
  marketWETHAddress: inject("MarketWETH"),
  previewerAddress: inject("Previewer"),
  proposalManagerAddress: inject("ProposalManager"),
  refunderAddress: inject("Refunder"),
  usdcAddress: inject("USDC"),
  wethAddress: inject("WETH"),
}));
