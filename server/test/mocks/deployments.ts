import { foundry } from "viem/chains";
import { inject, vi } from "vitest";

import type { Address } from "@exactly/common/validation";

let firewall: Address | undefined = inject("Firewall");

export default {
  setFirewall(address: Address | undefined) {
    firewall = address;
  },
};

vi.mock("@exactly/common/generated/chain", async (importOriginal) => ({
  ...(await importOriginal()),
  default: { ...foundry, rpcUrls: { ...foundry.rpcUrls, alchemy: foundry.rpcUrls.default } },
  auditorAddress: inject("Auditor"),
  debtManagerAddress: inject("DebtManager"),
  exaAccountFactoryAddress: inject("ExaAccountFactory"),
  exaPluginAddress: inject("ExaPlugin"),
  exaPreviewerAddress: inject("ExaPreviewer"),
  get firewallAddress() {
    return firewall;
  },
  issuerCheckerAddress: inject("IssuerChecker"),
  marketUSDCAddress: inject("MarketUSDC"),
  marketWETHAddress: inject("MarketWETH"),
  previewerAddress: inject("Previewer"),
  proposalManagerAddress: inject("ProposalManager"),
  refunderAddress: inject("Refunder"),
  usdcAddress: inject("USDC"),
  wethAddress: inject("WETH"),
}));
