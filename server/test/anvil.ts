import { Address } from "@exactly/common/validation";
import { $ } from "execa";
import { readdir } from "node:fs/promises";
import { anvil } from "prool/instances";
import { literal, object, parse, tuple } from "valibot";
import { keccak256, padHex, toBytes, toHex, zeroAddress } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { foundry } from "viem/chains";
import type { TestProject } from "vitest/node";

import anvilClient from "./anvilClient";
import { exaPluginAbi } from "../generated/contracts";

export default async function setup({ provide }: TestProject) {
  const instance = anvil({ codeSizeLimit: 69_000, blockBaseFeePerGas: 1n });
  const initialize = await instance
    .start()
    .then(() => true)
    .catch(() => false);

  const keeper = privateKeyToAccount(padHex("0x69"));
  if (initialize) await anvilClient.setBalance({ address: keeper.address, value: 10n ** 24n });

  const deployer = await anvilClient
    .getAddresses()
    .then(([address]) => address ?? zeroAddress)
    .catch(() => zeroAddress);
  const shell = {
    cwd: "node_modules/@exactly/plugin",
    env: {
      OPTIMISM_ETHERSCAN_KEY: "",
      ISSUER_ADDRESS: privateKeyToAddress(padHex("0x420")),
      KEEPER_ADDRESS: keeper.address,
      DEPLOYER_ADDRESS: deployer,
      ADMIN_ADDRESS: deployer,
    } as Record<string, string>,
  };

  if (initialize) {
    await $(shell)`forge script test/mocks/Protocol.s.sol --code-size-limit 69000
      --unlocked ${deployer} --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
  }

  const protocol = parse(
    Protocol,
    await import(`@exactly/plugin/broadcast/Protocol.s.sol/${foundry.id}/run-latest.json`),
  ).transactions;
  const auditor = protocol[1].contractAddress;
  const exa = protocol[3].contractAddress;
  const marketEXA = protocol[5].contractAddress;
  const usdc = protocol[11].contractAddress;
  const marketUSDC = protocol[13].contractAddress;
  const weth = protocol[19].contractAddress;
  const marketWETH = protocol[21].contractAddress;
  const balancer = protocol[27].contractAddress;
  const debtManager = protocol[28].contractAddress;
  const previewer = protocol[30].contractAddress;
  const installmentsRouter = protocol[31].contractAddress;

  if (initialize) {
    // cspell:ignoreRegExp [\b_][A-Z]+_ADDRESS\b
    shell.env.PROTOCOL_AUDITOR_ADDRESS = auditor;
    shell.env.PROTOCOL_EXA_ADDRESS = exa;
    shell.env.PROTOCOL_MARKETEXA_ADDRESS = marketEXA;
    shell.env.PROTOCOL_USDC_ADDRESS = usdc;
    shell.env.PROTOCOL_MARKETUSDC_ADDRESS = marketUSDC;
    shell.env.PROTOCOL_WETH_ADDRESS = weth;
    shell.env.PROTOCOL_MARKETWETH_ADDRESS = marketWETH;
    shell.env.PROTOCOL_BALANCERVAULT_ADDRESS = balancer;
    shell.env.PROTOCOL_DEBTMANAGER_ADDRESS = debtManager;
    shell.env.PROTOCOL_PREVIEWER_ADDRESS = previewer;
    shell.env.PROTOCOL_INSTALLMENTSROUTER_ADDRESS = installmentsRouter;
    shell.env.PROTOCOL_ESEXA_ADDRESS = padHex("0x666", { size: 20 });
    shell.env.PROTOCOL_REWARDSCONTROLLER_ADDRESS = padHex("0x666", { size: 20 });

    await $(shell)`forge script test/mocks/Mocks.s.sol
      --unlocked ${deployer} --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
    shell.env.SWAPPER_ADDRESS = parse(
      object({
        transactions: tuple([
          object({ contractName: literal("MockVelodromeFactory"), contractAddress: Address }),
          object({ contractName: literal("MockSwapper"), contractAddress: Address }),
        ]),
      }),
      await import(`@exactly/plugin/broadcast/Mocks.s.sol/${foundry.id}/run-latest.json`),
    ).transactions[1].contractAddress;

    await $(shell)`forge script node_modules/webauthn-owner-plugin/script/Plugin.s.sol --sender ${deployer}
      --unlocked ${deployer} --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
    shell.env.BROADCAST_WEBAUTHNOWNERPLUGIN_ADDRESS = parse(
      object({
        transactions: tuple([object({ contractName: literal("WebauthnOwnerPlugin"), contractAddress: Address })]),
      }),
      await import(`@exactly/plugin/broadcast/Plugin.s.sol/${foundry.id}/run-latest.json`),
    ).transactions[0].contractAddress;

    await $(shell)`forge script test/mocks/Account.s.sol
      --unlocked ${deployer} --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
    await $(shell)`forge script script/IssuerChecker.s.sol
      --unlocked ${deployer} --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
    await $(shell)`forge script script/ProposalManager.s.sol
      --unlocked ${deployer} --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
    await $(shell)`forge script script/Refunder.s.sol
      --unlocked ${deployer} --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
    await $(shell)`forge script script/ExaPreviewer.s.sol
      --unlocked ${deployer} --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
    await $(shell)`forge script script/ExaPlugin.s.sol
      --unlocked ${deployer} --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
    await $(shell)`forge script script/ExaAccountFactory.s.sol
      --unlocked ${deployer} --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;

    const bob = privateKeyToAddress(padHex("0xb0b"));
    await Promise.all([
      anvilClient.impersonateAccount({ address: bob }),
      anvilClient.impersonateAccount({ address: keeper.address }),
    ]);
    await $(shell)`forge script test/mocks/Bob.s.sol
      --unlocked ${bob},${keeper.address} --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
    await Promise.all([
      anvilClient.stopImpersonatingAccount({ address: bob }),
      anvilClient.mine({ blocks: 1, interval: 10 * 60 }),
    ]);
    await $(shell)`forge script test/mocks/BobExecute.s.sol
      --unlocked ${keeper.address} --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
    await anvilClient.stopImpersonatingAccount({ address: keeper.address });
  }

  const [issuerChecker, proposalManager, refunder, exaPreviewer, exaPlugin, exaAccountFactory] = await Promise.all([
    import(`@exactly/plugin/broadcast/IssuerChecker.s.sol/${foundry.id}/run-latest.json`).then(
      (json) =>
        parse(object({ transactions: tuple([object({ contractAddress: Address })]) }), json).transactions[0]
          .contractAddress,
    ),
    import(`@exactly/plugin/broadcast/ProposalManager.s.sol/${foundry.id}/run-latest.json`).then(
      (json) =>
        parse(object({ transactions: tuple([object({ contractAddress: Address })]) }), json).transactions[0]
          .contractAddress,
    ),
    import(`@exactly/plugin/broadcast/Refunder.s.sol/${foundry.id}/run-latest.json`).then(
      (json) =>
        parse(object({ transactions: tuple([object({ contractAddress: Address })]) }), json).transactions[0]
          .contractAddress,
    ),
    import(`@exactly/plugin/broadcast/ExaPreviewer.s.sol/${foundry.id}/run-latest.json`).then(
      (json) =>
        parse(object({ transactions: tuple([object({ contractAddress: Address })]) }), json).transactions[0]
          .contractAddress,
    ),
    import(`@exactly/plugin/broadcast/ExaPlugin.s.sol/${foundry.id}/run-latest.json`).then(
      (json) =>
        parse(object({ transactions: tuple([object({ contractAddress: Address })]) }), json).transactions[0]
          .contractAddress,
    ),
    import(`@exactly/plugin/broadcast/ExaAccountFactory.s.sol/${foundry.id}/run-latest.json`).then(
      (json) =>
        parse(
          object({
            transactions: tuple([
              object({ transactionType: literal("CALL"), function: literal("deploy(bytes32,bytes)") }),
              object({ contractName: literal("ExaAccountFactory"), contractAddress: Address }),
            ]),
          }),
          json,
        ).transactions[1].contractAddress,
    ),
  ]);

  if (initialize) {
    const files = await readdir(__dirname, { recursive: true }); // eslint-disable-line unicorn/prefer-module
    for (const testFile of files.filter((file) => file.endsWith(".test.ts"))) {
      const address = privateKeyToAddress(keccak256(toBytes(testFile)));
      await anvilClient.setBalance({ address, value: 10n ** 24n });
      for (const contract of [exaPlugin, refunder]) {
        await anvilClient.writeContract({
          address: contract,
          functionName: "grantRole",
          args: [keccak256(toHex("KEEPER_ROLE")), address],
          abi: exaPluginAbi,
          account: null,
        });
      }
    }
  }

  provide("Auditor", auditor);
  provide("BalancerVault", balancer);
  provide("DebtManager", debtManager);
  provide("ExaPreviewer", exaPreviewer);
  provide("EXA", exa);
  provide("ExaAccountFactory", exaAccountFactory);
  provide("ExaPlugin", exaPlugin);
  provide("InstallmentsRouter", installmentsRouter);
  provide("IssuerChecker", issuerChecker);
  provide("MarketEXA", marketEXA);
  provide("MarketUSDC", marketUSDC);
  provide("MarketWETH", marketWETH);
  provide("Previewer", previewer);
  provide("ProposalManager", proposalManager);
  provide("Refunder", refunder);
  provide("USDC", usdc);
  provide("WETH", weth);

  return async function teardown() {
    await instance.stop();
  };
}

const Protocol = object({
  transactions: tuple([
    object({ transactionType: literal("CREATE"), contractName: literal("Auditor") }),
    object({ transactionType: literal("CREATE"), contractName: literal("ERC1967Proxy"), contractAddress: Address }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("MockERC20"), contractAddress: Address }),
    object({ transactionType: literal("CREATE"), contractName: literal("Market") }),
    object({ transactionType: literal("CREATE"), contractName: literal("ERC1967Proxy"), contractAddress: Address }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("InterestRateModel") }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("MockPriceFeed") }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("MockERC20"), contractAddress: Address }),
    object({ transactionType: literal("CREATE"), contractName: literal("Market") }),
    object({ transactionType: literal("CREATE"), contractName: literal("ERC1967Proxy"), contractAddress: Address }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("InterestRateModel") }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("MockPriceFeed") }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("MockWETH"), contractAddress: Address }),
    object({ transactionType: literal("CREATE"), contractName: literal("Market") }),
    object({ transactionType: literal("CREATE"), contractName: literal("ERC1967Proxy"), contractAddress: Address }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("InterestRateModel") }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("MockPriceFeed") }),
    object({ transactionType: literal("CALL") }),
    object({
      transactionType: literal("CREATE"),
      contractName: literal("MockBalancerVault"),
      contractAddress: Address,
    }),
    object({ transactionType: literal("CREATE"), contractName: literal("DebtManager"), contractAddress: Address }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("Previewer"), contractAddress: Address }),
    object({
      transactionType: literal("CREATE"),
      contractName: literal("InstallmentsRouter"),
      contractAddress: Address,
    }),
  ]),
});

declare module "vitest" {
  export interface ProvidedContext {
    Auditor: Address;
    BalancerVault: Address;
    DebtManager: Address;
    ExaPreviewer: Address;
    EXA: Address;
    ExaAccountFactory: Address;
    ExaPlugin: Address;
    InstallmentsRouter: Address;
    IssuerChecker: Address;
    MarketEXA: Address;
    MarketUSDC: Address;
    MarketWETH: Address;
    ProposalManager: Address;
    Previewer: Address;
    Refunder: Address;
    USDC: Address;
    WETH: Address;
  }
}
