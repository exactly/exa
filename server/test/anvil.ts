import { $ } from "execa";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { env, stderr, stdout } from "node:process";
import { Instance } from "prool";
import { literal, object, parse, tuple } from "valibot";
import { encodeAbiParameters, keccak256, padHex, toBytes, toHex, zeroAddress, type Hex } from "viem";
import { mnemonicToAccount, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { foundry } from "viem/chains";

import { Address } from "@exactly/common/validation";
import deploy from "@exactly/plugin/deploy.json";

import anvilClient from "./anvilClient";

import type { TestProject } from "vitest/node";

export default async function setup({ provide }: Pick<TestProject, "provide">) {
  const instance = Instance.anvil({ codeSizeLimit: 69_000, blockBaseFeePerGas: 1n });
  await instance.start();
  const docker = env.NODE_ENV === "e2e" && !env.CI && (await $`docker info`.then(() => true).catch(() => false));
  if (docker) {
    await $({ cwd: "test" })`docker compose down`;
    await $({ cwd: "test" })`docker compose up -d --wait`;
    spawn(
      "node",
      [
        "-e",
        'process.stdin.resume();process.stdin.on("end",()=>require("child_process").execSync("docker compose down",{cwd:"test"}))',
      ],
      { detached: true, stdio: ["pipe", "ignore", "ignore"] },
    ).unref();
  }

  const keeper = privateKeyToAccount(padHex("0x69"));
  await anvilClient.setBalance({ address: keeper.address, value: 10n ** 24n });
  if (env.NODE_ENV === "e2e") {
    instance.on("stderr", (message) => stderr.write(message));
    instance.on("stdout", (message) => {
      if (
        !message.startsWith("eth_blockNumber") &&
        !message.startsWith("eth_call") &&
        !message.startsWith("eth_chainId") &&
        !message.startsWith("eth_feeHistory") &&
        !message.startsWith("eth_gasPrice") &&
        !message.startsWith("eth_getAccount") &&
        !message.startsWith("eth_getAccountInfo") &&
        !message.startsWith("eth_getBlockByNumber") &&
        !message.startsWith("eth_getCode") &&
        !message.startsWith("eth_getStorageAt") &&
        !message.startsWith("eth_getTransactionReceipt")
      ) {
        stdout.write(message);
      }
    });
    if (env.EXPO_PUBLIC_E2E_MNEMONIC) {
      await anvilClient.setBalance({
        address: mnemonicToAccount(env.EXPO_PUBLIC_E2E_MNEMONIC).address,
        value: 10n ** 24n,
      });
    }
  }

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

  await $(shell)`forge script test/mocks/Protocol.s.sol --code-size-limit 69000
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;

  const protocol = parse(
    Protocol,
    JSON.parse(await readFile("node_modules/@exactly/plugin/broadcast/Protocol.s.sol/31337/run-latest.json", "utf8")),
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
  const previewer = protocol[32].contractAddress;
  const integrationPreviewer = protocol[33].contractAddress;
  const ratePreviewer = protocol[34].contractAddress;
  const installmentsRouter = protocol[35].contractAddress;
  const firewall = protocol[37].contractAddress;

  // cspell:ignoreRegExp [\b_][A-Z]+_ADDRESS\b
  shell.env.PROTOCOL_AUDITOR_ADDRESS = auditor;
  shell.env.PROTOCOL_EXA_ADDRESS = exa;
  shell.env.PROTOCOL_MARKETEXA_ADDRESS = marketEXA;
  shell.env.PROTOCOL_USDC_ADDRESS = usdc;
  shell.env.PROTOCOL_MARKETUSDC_ADDRESS = marketUSDC;
  shell.env.PROTOCOL_WETH_ADDRESS = weth;
  shell.env.PROTOCOL_MARKETWETH_ADDRESS = marketWETH;
  shell.env.PROTOCOL_BALANCER2VAULT_ADDRESS = balancer;
  shell.env.PROTOCOL_DEBTMANAGER_ADDRESS = debtManager;
  shell.env.PROTOCOL_PREVIEWER_ADDRESS = previewer;
  shell.env.PROTOCOL_INTEGRATIONPREVIEWER_ADDRESS = integrationPreviewer;
  shell.env.PROTOCOL_RATEPREVIEWER_ADDRESS = ratePreviewer;
  shell.env.PROTOCOL_INSTALLMENTSROUTER_ADDRESS = installmentsRouter;
  shell.env.PROTOCOL_FIREWALL_ADDRESS = firewall;
  shell.env.PROTOCOL_ESEXA_ADDRESS = padHex("0x666", { size: 20 });
  shell.env.PROTOCOL_REWARDSCONTROLLER_ADDRESS = padHex("0x666", { size: 20 });

  await $(shell)`forge script test/mocks/Mocks.s.sol
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
  shell.env.SWAPPER_ADDRESS = parse(
    object({
      transactions: tuple([
        object({ contractName: literal("MockVelodromeFactory"), contractAddress: Address }),
        object({ contractName: literal("MockSwapper"), contractAddress: Address }),
      ]),
    }),
    JSON.parse(await readFile("node_modules/@exactly/plugin/broadcast/Mocks.s.sol/31337/run-latest.json", "utf8")),
  ).transactions[1].contractAddress;

  await $(shell)`forge script node_modules/webauthn-owner-plugin/script/Plugin.s.sol --sender ${deployer}
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
  shell.env.BROADCAST_WEBAUTHNOWNERPLUGIN_ADDRESS = parse(
    object({
      transactions: tuple([object({ contractName: literal("WebauthnOwnerPlugin"), contractAddress: Address })]),
    }),
    JSON.parse(await readFile("node_modules/@exactly/plugin/broadcast/Plugin.s.sol/31337/run-latest.json", "utf8")),
  ).transactions[0].contractAddress;

  await $(shell)`forge script test/mocks/Account.s.sol
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
  await $(shell)`forge script script/IssuerChecker.s.sol
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
  await $(shell)`forge script script/ProposalManager.s.sol
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
  await $(shell)`forge script script/Refunder.s.sol
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
  await $(shell)`forge script script/ExaPreviewer.s.sol
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
  await $(shell)`forge script script/ExaPlugin.s.sol
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
  await $(shell)`forge script script/ExaAccountFactory.s.sol
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;

  const bob = privateKeyToAddress(padHex("0xb0b"));
  await Promise.all([
    anvilClient.impersonateAccount({ address: bob }),
    anvilClient.impersonateAccount({ address: keeper.address }),
  ]);
  await $(shell)`forge script test/mocks/Bob.s.sol
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
  await Promise.all([
    anvilClient.stopImpersonatingAccount({ address: bob }),
    anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[foundry.id] }),
  ]);
  await $(shell)`forge script test/mocks/BobExecute.s.sol --tc BobExecuteScript
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation`;
  await anvilClient.stopImpersonatingAccount({ address: keeper.address });

  const [issuerChecker, proposalManager, refunder, exaPreviewer, exaPlugin, exaAccountFactory] = await Promise.all([
    readFile("node_modules/@exactly/plugin/broadcast/IssuerChecker.s.sol/31337/run-latest.json", "utf8"),
    readFile("node_modules/@exactly/plugin/broadcast/ProposalManager.s.sol/31337/run-latest.json", "utf8"),
    readFile("node_modules/@exactly/plugin/broadcast/Refunder.s.sol/31337/run-latest.json", "utf8"),
    readFile("node_modules/@exactly/plugin/broadcast/ExaPreviewer.s.sol/31337/run-latest.json", "utf8"),
    readFile("node_modules/@exactly/plugin/broadcast/ExaPlugin.s.sol/31337/run-latest.json", "utf8"),
    readFile("node_modules/@exactly/plugin/broadcast/ExaAccountFactory.s.sol/31337/run-latest.json", "utf8"),
  ]).then(
    ([issuerChecker_, proposalManager_, refunder_, exaPreviewer_, exaPlugin_, exaAccountFactory_]) =>
      [
        parse(object({ transactions: tuple([object({ contractAddress: Address })]) }), JSON.parse(issuerChecker_))
          .transactions[0].contractAddress,
        parse(object({ transactions: tuple([object({ contractAddress: Address })]) }), JSON.parse(proposalManager_))
          .transactions[0].contractAddress,
        parse(object({ transactions: tuple([object({ contractAddress: Address })]) }), JSON.parse(refunder_))
          .transactions[0].contractAddress,
        parse(object({ transactions: tuple([object({ contractAddress: Address })]) }), JSON.parse(exaPreviewer_))
          .transactions[0].contractAddress,
        parse(object({ transactions: tuple([object({ contractAddress: Address })]) }), JSON.parse(exaPlugin_))
          .transactions[0].contractAddress,
        parse(
          object({
            transactions: tuple([
              object({ transactionType: literal("CALL"), function: literal("deploy(bytes32,bytes)") }),
              object({ contractName: literal("ExaAccountFactory"), contractAddress: Address }),
            ]),
          }),
          JSON.parse(exaAccountFactory_),
        ).transactions[1].contractAddress,
      ] as const,
  );

  const files = await readdir(__dirname, { recursive: true }); // eslint-disable-line unicorn/prefer-module
  for (const testFile of files.filter((file) => file.endsWith(".test.ts") || file.endsWith("e2e.ts"))) {
    const address = privateKeyToAddress(keccak256(toBytes(testFile)));
    await anvilClient.setBalance({ address, value: 10n ** 24n });
    for (const contract of [exaPlugin, refunder]) {
      await anvilClient.writeContract({
        address: contract,
        functionName: "grantRole",
        args: [keccak256(toHex("KEEPER_ROLE")), address],
        abi: [
          {
            type: "function",
            name: "grantRole",
            stateMutability: "nonpayable",
            inputs: [{ type: "bytes32" }, { type: "address" }],
            outputs: [],
          },
        ],
        account: null,
      });
    }
  }

  if (docker) {
    const entries = await readdir("node_modules/@exactly/plugin/broadcast", { withFileTypes: true });
    const broadcasts = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- controlled path from broadcast directory
          readFile(`node_modules/@exactly/plugin/broadcast/${entry.name}/31337/run-latest.json`, "utf8").catch(
            () => null,
          ),
        ),
    );
    const verify = (address: string, name: string, args?: Hex) =>
      $(shell)`forge verify-contract ${address} ${name} ${args ? [`--constructor-args=${args}`] : []}
          -c 31337 --verifier=sourcify --verifier-url=http://localhost:5555`;
    await Promise.all([
      ...broadcasts
        .filter((content): content is string => content !== null)
        .flatMap((content) =>
          (
            JSON.parse(content) as {
              transactions: {
                contractAddress?: string;
                contractName?: string;
                function?: string;
                transactionType: string;
              }[];
            }
          ).transactions
            .flatMap((tx, index, txs) => [
              ...(tx.transactionType === "CREATE" && tx.contractName && tx.contractAddress
                ? [{ contractAddress: tx.contractAddress, contractName: tx.contractName }]
                : []),
              ...((next) =>
                tx.transactionType === "CALL" &&
                tx.function === "deploy(bytes32,bytes)" &&
                next?.contractName &&
                next.contractAddress
                  ? [{ contractAddress: next.contractAddress, contractName: next.contractName }]
                  : [])(txs[index + 1]),
            ])
            .map(({ contractAddress, contractName }) => ({
              contractAddress,
              contractName:
                {
                  MockERC20: "node_modules/solmate/src/test/utils/mocks/MockERC20.sol:MockERC20",
                  MockWETH: "node_modules/@exactly/protocol/contracts/mocks/MockWETH.sol:MockWETH",
                }[contractName] ?? contractName,
            })),
        )
        .map(({ contractAddress, contractName }) => verify(contractAddress, contractName)),
      verify("0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", "EntryPoint"),
      verify("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "MockPaymaster"),
      verify(
        "0x0046000000000151008789797b54fdb500E2a61e",
        "UpgradeableModularAccount",
        encodeAbiParameters([{ type: "address" }], ["0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"]),
      ),
    ]);
  }

  provide("Auditor", auditor);
  provide("Balancer2Vault", balancer);
  provide("ExaPreviewer", exaPreviewer);
  provide("EXA", exa);
  provide("ExaAccountFactory", exaAccountFactory);
  provide("ExaPlugin", exaPlugin);
  provide("Firewall", firewall);
  provide("InstallmentsRouter", installmentsRouter);
  provide("IntegrationPreviewer", integrationPreviewer);
  provide("IssuerChecker", issuerChecker);
  provide("MarketEXA", marketEXA);
  provide("MarketUSDC", marketUSDC);
  provide("MarketWETH", marketWETH);
  provide("Previewer", previewer);
  provide("ProposalManager", proposalManager);
  provide("RatePreviewer", ratePreviewer);
  provide("Refunder", refunder);
  provide("USDC", usdc);
  provide("WETH", weth);

  return async function teardown() {
    if (docker) await $({ cwd: "test" })`docker compose down`;
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
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("Previewer"), contractAddress: Address }),
    object({
      transactionType: literal("CREATE"),
      contractName: literal("IntegrationPreviewer"),
      contractAddress: Address,
    }),
    object({ transactionType: literal("CREATE"), contractName: literal("RatePreviewer"), contractAddress: Address }),
    object({
      transactionType: literal("CREATE"),
      contractName: literal("InstallmentsRouter"),
      contractAddress: Address,
    }),
    object({ transactionType: literal("CREATE"), contractName: literal("Firewall") }),
    object({ transactionType: literal("CREATE"), contractName: literal("ERC1967Proxy"), contractAddress: Address }),
  ]),
});

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- module augmentation requires interface merging
  export interface ProvidedContext {
    Auditor: Address;
    Balancer2Vault: Address;
    EXA: Address;
    ExaAccountFactory: Address;
    ExaPlugin: Address;
    ExaPreviewer: Address;
    Firewall: Address;
    InstallmentsRouter: Address;
    IntegrationPreviewer: Address;
    IssuerChecker: Address;
    MarketEXA: Address;
    MarketUSDC: Address;
    MarketWETH: Address;
    Previewer: Address;
    ProposalManager: Address;
    RatePreviewer: Address;
    Refunder: Address;
    USDC: Address;
    WETH: Address;
  }
}
