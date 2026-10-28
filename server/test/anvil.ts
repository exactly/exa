import { $ } from "execa";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { Agent, createServer, request } from "node:http";
import { env, stderr, stdout } from "node:process";
import { text } from "node:stream/consumers";
import { Instance } from "prool";
import { literal, object, parse, tuple } from "valibot";
import {
  concat,
  createTestClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  numberToHex,
  padHex,
  parseAbi,
  publicActions,
  toBytes,
  toHex,
  zeroAddress,
  type Hex,
} from "viem";
import {
  entryPoint06Address,
  formatUserOperation,
  getUserOperationHash,
  type RpcUserOperation,
} from "viem/account-abstraction";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { anvil, foundry, moonbeamDev, optimism } from "viem/chains";

import { Address } from "@exactly/common/validation";
import deploy from "@exactly/plugin/deploy.json";

import anvilClient from "./anvilClient";

export default async function setup() {
  if (!env.NX_TASK_TARGET_PROJECT) {
    await $({ cwd: "..", env: { CHAIN_ID: String(foundry.id) }, preferLocal: true })`nx prepare server`;
  }
  const instances = chains.map(({ id, rpcUrls }) =>
    Instance.anvil({
      codeSizeLimit: 69_000,
      blockBaseFeePerGas: 1n,
      chainId: id,
      port: Number(new URL(rpcUrls.default.http[0]).port) + (env.NODE_ENV === "e2e" ? 1 : 0),
    }),
  );
  await Promise.all(instances.map((instance) => instance.start()));
  const rpcs = env.NODE_ENV === "e2e" ? chains.map((chain) => alchemy(chain)) : [];
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
    for (const instance of instances) {
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
          !message.startsWith("eth_getFilterChanges") &&
          !message.startsWith("eth_getBlockByNumber") &&
          !message.startsWith("eth_getCode") &&
          !message.startsWith("eth_getStorageAt") &&
          !message.startsWith("eth_getTransactionReceipt")
        ) {
          stdout.write(message);
        }
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
      FOUNDRY_PROFILE: "tooling",
      ETHERSCAN_KEY: "",
      ISSUER_ADDRESS: privateKeyToAddress(padHex("0x420")),
      KEEPER_ADDRESS: keeper.address,
      DEPLOYER_ADDRESS: deployer,
      ADMIN_ADDRESS: deployer,
    } as Record<string, string>,
  };

  function forge(...args: string[]) {
    return Promise.all(
      chains.map(
        ({ rpcUrls }) =>
          $(shell)`forge script ${args}
              --unlocked --rpc-url ${rpcUrls.default.http[0]} --broadcast --skip-simulation --offline`,
      ),
    );
  }

  await $(shell)`forge compiler resolve`;
  await forge("test/mocks/Protocol.s.sol", "--disable-code-size-limit");

  const protocol = parse(
    Protocol,
    JSON.parse(await readFile("node_modules/@exactly/plugin/broadcast/Protocol.s.sol/31337/run-latest.json", "utf8")),
  ).transactions;
  const auditor = protocol[1].contractAddress;
  const exa = protocol[2].contractAddress;
  const marketEXA = protocol[4].contractAddress;
  const usdc = protocol[9].contractAddress;
  const marketUSDC = protocol[11].contractAddress;
  const weth = protocol[16].contractAddress;
  const marketWETH = protocol[18].contractAddress;
  const balancer = protocol[23].contractAddress;
  const debtManager = protocol[24].contractAddress;
  const previewer = protocol[28].contractAddress;
  const integrationPreviewer = protocol[29].contractAddress;
  const ratePreviewer = protocol[30].contractAddress;
  const installmentsRouter = protocol[31].contractAddress;
  const firewall = protocol[33].contractAddress;

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

  await forge("test/mocks/Mocks.s.sol");

  await forge("test/mocks/Account.s.sol");
  const [plugin, , paymaster] = parse(
    object({
      transactions: tuple([
        object({ contractName: literal("WebauthnOwnerPlugin"), contractAddress: Address }),
        object({ contractName: literal("UpgradeableModularAccount") }),
        object({ contractName: literal("VerifyingPaymaster"), contractAddress: Address }),
      ]),
    }),
    JSON.parse(await readFile("node_modules/@exactly/plugin/broadcast/Account.s.sol/31337/run-latest.json", "utf8")),
  ).transactions;
  shell.env.BROADCAST_WEBAUTHNOWNERPLUGIN_ADDRESS = plugin.contractAddress;
  const started = Promise.all(rpcs.map((rpc) => rpc.start(paymaster.contractAddress)));

  await forge("test/mocks/ExaBusinessTenant.s.sol");
  await forge("script/IssuerChecker.s.sol");
  await forge("script/ProposalManager.s.sol");
  await forge("script/Refunder.s.sol");
  await forge("script/ExaPreviewer.s.sol");
  await forge("script/ExaPlugin.s.sol");
  await forge("script/ExaAccountFactory.s.sol");

  const bob = privateKeyToAddress(padHex("0xb0b"));
  await Promise.all([
    anvilClient.impersonateAccount({ address: bob }),
    anvilClient.impersonateAccount({ address: keeper.address }),
  ]);
  await $(shell)`forge script test/mocks/Bob.s.sol
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation --offline`;
  await Promise.all([
    anvilClient.stopImpersonatingAccount({ address: bob }),
    anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[foundry.id] }),
  ]);
  await $(shell)`forge script test/mocks/BobExecute.s.sol --tc BobExecuteScript
      --unlocked --rpc-url ${foundry.rpcUrls.default.http[0]} --broadcast --skip-simulation --offline`;
  await anvilClient.stopImpersonatingAccount({ address: keeper.address });

  const [exaBusinessTenant, refunder, exaPlugin] = await Promise.all([
    readFile("node_modules/@exactly/plugin/broadcast/ExaBusinessTenant.s.sol/31337/run-latest.json", "utf8"),
    readFile("node_modules/@exactly/plugin/broadcast/Refunder.s.sol/31337/run-latest.json", "utf8"),
    readFile("node_modules/@exactly/plugin/broadcast/ExaPlugin.s.sol/31337/run-latest.json", "utf8"),
  ]).then(
    ([exaBusinessTenant_, refunder_, exaPlugin_]) =>
      [
        parse(object({ returns: object({ manager: object({ value: Address }) }) }), JSON.parse(exaBusinessTenant_))
          .returns.manager.value,
        parse(object({ transactions: tuple([object({ contractAddress: Address })]) }), JSON.parse(refunder_))
          .transactions[0].contractAddress,
        parse(object({ transactions: tuple([object({ contractAddress: Address })]) }), JSON.parse(exaPlugin_))
          .transactions[0].contractAddress,
      ] as const,
  );

  const files = await readdir(__dirname, { recursive: true }); // eslint-disable-line unicorn/prefer-module
  for (const testFile of files.filter((file) => file.endsWith(".test.ts") || file.endsWith("e2e.ts"))) {
    const address = privateKeyToAddress(keccak256(toBytes(testFile)));
    await anvilClient.setBalance({ address, value: 10n ** 24n });
    for (const contract of [exaPlugin, refunder]) {
      await anvilClient.waitForTransactionReceipt({
        hash: await anvilClient.writeContract({
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
        }),
      });
    }
  }

  await Promise.all(
    chains.slice(1).map(async (chain) => {
      const client = createTestClient({ chain, mode: "anvil", transport: http() }).extend(publicActions);
      await Promise.all([
        $(shell)`forge script test/mocks/Mocks.s.sol --sig frozenMarket()
            --unlocked --rpc-url ${chain.rpcUrls.default.http[0]} --broadcast --skip-simulation --offline`,
        client.setBalance({ address: privateKeyToAddress(keccak256(toBytes("e2e.ts"))), value: 10n ** 24n }),
      ]);
      if (
        !(await client.readContract({
          address: parse(
            object({ returns: object({ market: object({ value: Address }) }) }),
            JSON.parse(
              // eslint-disable-next-line security/detect-non-literal-fs-filename -- controlled path from broadcast directory
              await readFile(
                `node_modules/@exactly/plugin/broadcast/Mocks.s.sol/${chain.id}/frozenMarket-latest.json`,
                "utf8",
              ),
            ),
          ).returns.market.value,
          functionName: "isFrozen",
          abi: parseAbi(["function isFrozen() view returns (bool)"]),
        }))
      ) {
        throw new Error("market not frozen");
      }
    }),
  );

  await started;

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
                  ERC1967Proxy: "node_modules/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy",
                  MockERC20: "node_modules/solmate/src/test/utils/mocks/MockERC20.sol:MockERC20",
                  MockWETH: "node_modules/@exactly/protocol/contracts/mocks/MockWETH.sol:MockWETH",
                }[contractName] ?? contractName,
            })),
        )
        .map(({ contractAddress, contractName }) => verify(contractAddress, contractName)),
      verify("0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", "EntryPoint"),
      verify(exaBusinessTenant, "AccessManager", encodeAbiParameters([{ type: "address" }], [deployer])),
      verify(
        "0x0046000000000151008789797b54fdb500E2a61e",
        "UpgradeableModularAccount",
        encodeAbiParameters([{ type: "address" }], ["0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"]),
      ),
    ]);
  }

  return async function teardown() {
    if (docker) await $({ cwd: "test" })`docker compose down`;
    await Promise.all(rpcs.map((rpc) => rpc.stop()));
    await Promise.all(instances.map((instance) => instance.stop()));
  };
}

export const chains = [anvil, ...(env.NODE_ENV === "e2e" ? [{ ...moonbeamDev, name: "Anvil2" }] : [])].map((chain) => ({
  ...chain,
  blockTime: optimism.blockTime,
}));

const Protocol = object({
  transactions: tuple([
    object({ transactionType: literal("CREATE"), contractName: literal("Auditor") }),
    object({ transactionType: literal("CREATE"), contractName: literal("ERC1967Proxy"), contractAddress: Address }),
    object({ transactionType: literal("CREATE"), contractName: literal("MockERC20"), contractAddress: Address }),
    object({ transactionType: literal("CREATE"), contractName: literal("Market") }),
    object({ transactionType: literal("CREATE"), contractName: literal("ERC1967Proxy"), contractAddress: Address }),
    object({ transactionType: literal("CREATE"), contractName: literal("InterestRateModel") }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("MockPriceFeed") }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("MockERC20"), contractAddress: Address }),
    object({ transactionType: literal("CREATE"), contractName: literal("Market") }),
    object({ transactionType: literal("CREATE"), contractName: literal("ERC1967Proxy"), contractAddress: Address }),
    object({ transactionType: literal("CREATE"), contractName: literal("InterestRateModel") }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("MockPriceFeed") }),
    object({ transactionType: literal("CALL") }),
    object({ transactionType: literal("CREATE"), contractName: literal("MockWETH"), contractAddress: Address }),
    object({ transactionType: literal("CREATE"), contractName: literal("Market") }),
    object({ transactionType: literal("CREATE"), contractName: literal("ERC1967Proxy"), contractAddress: Address }),
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

function alchemy(chain: (typeof chains)[number]) {
  const port = Number(new URL(chain.rpcUrls.default.http[0]).port);
  const bundler = Instance.alto({
    entrypoints: [entryPoint06Address],
    executorPrivateKeys: [padHex("0x4337")],
    utilityPrivateKey: padHex("0x4337"),
    rpcUrl: `http://localhost:${port + 1}`,
    safeMode: true,
    port: port + 2,
  });
  const agent = new Agent({ keepAlive: true });
  const client = createTestClient({ chain, mode: "anvil", transport: http(`http://localhost:${port + 1}`) }).extend(
    publicActions,
  );
  const signer = privateKeyToAccount(padHex("0x4337"));
  let paymaster: Hex;
  const server = createServer((incoming, outgoing) => {
    outgoing.setHeader("access-control-allow-origin", "*");
    if (incoming.method === "OPTIONS") {
      outgoing
        .writeHead(204, {
          "access-control-allow-headers": incoming.headers["access-control-request-headers"] ?? "*",
          "access-control-max-age": "7200",
        })
        .end();
      return;
    }
    text(incoming)
      .then(async (body) => {
        const { id, method, params } = JSON.parse(body) as {
          id?: number;
          method?: string;
          params?: [unknown];
        };
        if (method === "alchemy_getTokenBalances" && params) {
          const owner = parse(Address, params[0]);
          const tokens = await client.getContractEvents({
            abi: erc20Abi,
            eventName: "Transfer",
            args: { to: owner },
            fromBlock: 0n,
          });
          outgoing.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: {
                address: owner,
                tokenBalances: await Promise.all(
                  [...new Set(tokens.map(({ address }) => address))].map(async (contractAddress) => ({
                    contractAddress,
                    tokenBalance: numberToHex(
                      await client.readContract({
                        address: contractAddress,
                        abi: erc20Abi,
                        functionName: "balanceOf",
                        args: [owner],
                      }),
                      { size: 32 },
                    ),
                  })),
                ),
              },
            }),
          );
          return;
        }
        if (method?.startsWith("pm_") && params) {
          outgoing.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: {
                paymasterAndData: concat([
                  paymaster,
                  await signer.signMessage({
                    message: {
                      raw: getUserOperationHash({
                        chainId: chain.id,
                        entryPointAddress: entryPoint06Address,
                        entryPointVersion: "0.6",
                        userOperation: {
                          ...formatUserOperation(params[0] as RpcUserOperation<"0.6">),
                          paymasterAndData: paymaster,
                        },
                      }),
                    },
                  }),
                ]),
              },
            }),
          );
          return;
        }
        request(
          {
            port: /UserOperation|EntryPoints/.test(method ?? "") ? bundler.port : port + 1,
            method: "POST",
            headers: { "content-type": "application/json" },
            agent,
          },
          (upstream) =>
            upstream.pipe(outgoing.writeHead(upstream.statusCode ?? 502, { "content-type": "application/json" })),
        )
          .on("error", (error) => outgoing.writeHead(502).end(error.message))
          .end(
            method === "rundler_maxPriorityFeePerGas" // cspell:ignore rundler
              ? JSON.stringify({ jsonrpc: "2.0", id, method: "eth_maxPriorityFeePerGas", params: [] })
              : body,
          );
      })
      .catch((error: unknown) => outgoing.writeHead(500).end(String(error)));
  }).listen(port);
  return {
    async start(address: Hex) {
      paymaster = address;
      await client.setBalance({ address: signer.address, value: 10n ** 24n });
      await bundler.start();
    },
    async stop() {
      server.close();
      await bundler.stop();
    },
  };
}
