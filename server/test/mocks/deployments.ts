import { foundry } from "viem/chains";
import { inject, vi } from "vitest";

vi.mock("@exactly/common/generated/chain", async (importOriginal) => ({
  ...(await importOriginal()),
  default: { ...foundry, rpcUrls: { ...foundry.rpcUrls, alchemy: foundry.rpcUrls.default } },
  auditorAddress: inject("Auditor"),
  exaPluginAddress: inject("ExaPlugin"),
  exaPreviewerAddress: inject("ExaPreviewer"),
  marketUSDCAddress: inject("MarketUSDC"),
  marketWETHAddress: inject("MarketWETH"),
  previewerAddress: inject("Previewer"),
  usdcAddress: inject("USDC"),
  wethAddress: inject("WETH"),
}));
vi.mock("../../generated/contracts", async (importOriginal) => ({
  ...(await importOriginal()),
  issuerCheckerAddress: inject("IssuerChecker"),
  proposalManagerAddress: inject("ProposalManager"),
  refunderAddress: inject("Refunder"),
}));
