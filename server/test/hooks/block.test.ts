import { createWebhook, findWebhook, headerValidator } from "../mocks/alchemy";
import sendPushNotificationMock from "../mocks/onesignal";
import "../mocks/sentry";
import "../mocks/traceClient";
import "../mocks/wallet";

import * as core from "@sentry/core";
import { captureException, continueTrace, getActiveSpan, setExtra, withScope } from "@sentry/node";
import { deserialize } from "@wagmi/core";
import { testClient } from "hono/testing";
import { Redis } from "ioredis";
import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { v5 } from "uuid";
import { parse } from "valibot";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  ExecutionRevertedError,
  formatUnits,
  getAbiItem,
  getAddress,
  getContractError,
  hexToBigInt,
  hexToBytes,
  http,
  HttpRequestError,
  maxUint256,
  nonceManager,
  padHex,
  parseAbi,
  parseEventLogs,
  RawContractError,
  toEventSelector,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import { entryPoint06Abi, entryPoint06Address, getUserOperationHash } from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { anvil, optimism } from "viem/chains";
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import chain, {
  auditorAbi,
  exaAccountFactoryAbi,
  exaAccountFactoryAddress,
  exaPluginAbi,
  exaPluginAddress,
  exaPreviewerAbi,
  exaPreviewerAddress,
  factories,
  issuerCheckerAbi,
  marketAbi,
  marketUSDCAddress,
  marketWETHAddress,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
  usdcAddress,
} from "@exactly/common/generated/chain";
import * as nonceKey from "@exactly/common/nonceKey";
import ProposalType, { decodeWithdraw } from "@exactly/common/ProposalType";
import shortenHex from "@exactly/common/shortenHex";
import * as validation from "@exactly/common/validation";
import deploy from "@exactly/plugin/deploy.json";

import database, { credentials } from "../../database";
import createBlockHook from "../../hooks/block";
import t, { f } from "../../i18n";
import createAlchemy from "../../utils/alchemy";
import appOrigin from "../../utils/appOrigin";
import ensClient from "../../utils/ensClient";
import { refresh } from "../../utils/liquidity";
import createOnesignal from "../../utils/onesignal";
import createPersona from "../../utils/persona";
import publicClient from "../../utils/publicClient";
import createManteca from "../../utils/ramps/manteca";
import redis from "../../utils/redis";
import revertFingerprint from "../../utils/revertFingerprint";
import ServiceError from "../../utils/ServiceError";
import wallet from "../../utils/wallet";
import anvilClient from "../anvilClient";

import type * as sentry from "@sentry/node";

let keeper: ReturnType<typeof wallet>;

const bob = createWalletClient({
  chain,
  transport: http(),
  account: privateKeyToAccount(padHex("0xb0b"), { nonceManager }),
});
const bobAccount = deriveAddress(exaAccountFactoryAddress, { x: padHex(bob.account.address), y: zeroHash });
const manteca = createManteca("manteca", "https://manteca.test");
const persona = createPersona("persona", "https://persona.test");
const settlement = parse(validation.Address, padHex("0x5e7", { size: 20 }));
const defaults = {
  alchemy: createAlchemy("webhooks"),
  database,
  executor: bob.account,
  manteca,
  onesignal: createOnesignal("onesignal"),
  persona,
  redis,
};
vi.mocked(findWebhook).mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- create path
const blockHook = createBlockHook(defaults);
const appClient = testClient(blockHook.app);

beforeAll(async () => {
  await blockHook.ready;
  keeper = wallet(privateKeyToAccount(padHex("0x69")));
});

describe("initialization", () => {
  const existing: NonNullable<Awaited<ReturnType<typeof findWebhook>>> = {
    id: "existing",
    is_active: true,
    network: "ANVIL",
    signing_key: "existing-signing-key",
    webhook_type: "GRAPHQL",
    webhook_url: "http://localhost:8081/hooks/block",
  };

  it("starts with a discovered key when reconciliation fails", async () => {
    const error = new Error("creation failed");
    vi.mocked(findWebhook).mockResolvedValueOnce(existing);
    vi.mocked(createWebhook).mockRejectedValueOnce(error);
    const currentHook = createBlockHook(defaults);

    await expect(currentHook.ready).resolves.toBeDefined();
    expect(headerValidator).toHaveBeenLastCalledWith(new Set([existing.signing_key]));
    expect(captureException).toHaveBeenCalledWith(error, { level: "warning" });
  });

  it("keeps both keys when the old webhook deletion fails", async () => {
    vi.mocked(findWebhook).mockResolvedValueOnce(existing);
    const { fetch } = globalThis;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
      (input instanceof Request ? input.url : String(input)).startsWith(
        "https://dashboard.alchemy.com/api/delete-webhook",
      )
        ? Promise.resolve(new Response("unavailable", { status: 503 }))
        : fetch(input, init),
    );
    const currentHook = createBlockHook(defaults);

    await expect(currentHook.ready).resolves.toBeDefined();
    expect(createWebhook).toHaveBeenCalledOnce();
    expect(headerValidator).toHaveBeenLastCalledWith(new Set([existing.signing_key, "mock-signing-key"]));
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Alchemy503", message: "unavailable", status: 503 }),
      { level: "warning" },
    );
  });

  it("keeps a webhook whose url carries its query hash", async () => {
    await createBlockHook(defaults).ready;
    const options = vi.mocked(createWebhook).mock.lastCall?.[0];
    if (!options || !("graphql_query" in options)) throw new Error("missing webhook");
    vi.mocked(createWebhook).mockClear();
    vi.mocked(findWebhook).mockResolvedValueOnce({ ...existing, webhook_url: options.webhook_url });
    const currentHook = createBlockHook(defaults);

    await expect(currentHook.ready).resolves.toBeDefined();
    expect(options.webhook_url).toBe(
      `${appOrigin}/hooks/block?query=${createHash("sha256").update(options.graphql_query.query).digest("hex")}`,
    );
    const { plugins, managers } = await factoryEmitters();
    expect(options.graphql_query.query).toContain(
      `addresses: ${JSON.stringify(
        [...new Set([exaPluginAddress, marketUSDCAddress, ...plugins, ...managers])].toSorted(),
      )}`,
    );
    expect(options.graphql_query.query).toContain(`"${withdrawTopic}" # Withdraw`);
    expect(options.graphql_query.query).toMatch(/transaction \{\s+hash\s+\}/);
    expect(createWebhook).not.toHaveBeenCalled();
    expect(headerValidator).toHaveBeenLastCalledWith(new Set([existing.signing_key]));
    const predicate = vi.mocked(findWebhook).mock.lastCall?.[0];
    expect(
      [
        { ...existing, webhook_url: `${appOrigin}/hooks/block` },
        { ...existing, webhook_url: options.webhook_url },
        { ...existing, webhook_url: `${appOrigin}/hooks/blocks` },
        { ...existing, webhook_type: "ADDRESS_ACTIVITY" as const, webhook_url: options.webhook_url },
      ].map((webhook) => predicate?.(webhook)),
    ).toStrictEqual([true, true, false, false]);
  });

  it("watches a plugin whose proposal manager read reverts", async () => {
    const { plugins } = await factoryEmitters();
    const { readContract } = publicClient;
    vi.spyOn(publicClient, "readContract").mockImplementation((parameters) =>
      parameters.functionName === "proposalManager"
        ? Promise.reject(new ExecutionRevertedError())
        : readContract(parameters),
    );
    await createBlockHook(defaults).ready;
    const options = vi.mocked(createWebhook).mock.lastCall?.[0];
    if (!options || !("graphql_query" in options)) throw new Error("missing webhook");

    expect(options.graphql_query.query).toContain(
      `addresses: ${JSON.stringify([...new Set([exaPluginAddress, marketUSDCAddress, ...plugins])].toSorted())}`,
    );
  });

  it("watches the legacy factories and plugins on optimism", async () => {
    const bytecode = await anvilClient.getCode({ address: exaAccountFactoryAddress });
    if (!bytecode) throw new Error("missing factory");
    await anvilClient.setCode({
      address: legacyFactory,
      bytecode: bytecode.replaceAll(
        exaPluginAddress.slice(2).toLowerCase(),
        legacyFactoryPlugin.slice(2).toLowerCase(),
      ) as Hex,
    });
    onTestFinished(() => anvilClient.setCode({ address: legacyFactory, bytecode: "0x" }));
    await createBlockHook({ ...defaults, chainId: optimism.id }).ready;
    const options = vi.mocked(createWebhook).mock.lastCall?.[0];
    if (!options || !("graphql_query" in options)) throw new Error("missing webhook");

    const { plugins, managers } = await factoryEmitters();
    expect(options.graphql_query.query).toContain(
      `addresses: ${JSON.stringify(
        [
          ...new Set([
            exaPluginAddress,
            marketUSDCAddress,
            legacyFactoryPlugin,
            ...legacyPlugins,
            ...plugins,
            ...managers,
          ]),
        ].toSorted(),
      )}`,
    );
  });

  it("fails without a signing key when initialization fails", async () => {
    const error = new Error("discovery failed");
    vi.mocked(findWebhook).mockRejectedValueOnce(error);
    const currentHook = createBlockHook(defaults);

    await expect(currentHook.ready).rejects.toBe(error);
  });
});

describe("validation", () => {
  it("accepts valid request", async () => {
    const response = await appClient.index.$post(blockPayload);

    expect(response.status).toBe(200);
  });

  it("skips credentials lookup without proposals", async () => {
    const findMany = vi.spyOn(database.query.credentials, "findMany");

    const response = await appClient.index.$post({
      header: {},
      json: {
        type: "GRAPHQL",
        event: {
          data: {
            block: {
              number: 1,
              timestamp: 1,
              logs: [{ topics: [zeroHash], data: "0x", account: { address: exaPluginAddress } }],
            },
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("proposal", () => {
  let proposals: Log<bigint, number, false, (typeof proposalManagerAbi)[29], true>[];

  function logs(emitter?: Address) {
    return proposals.map(({ topics, data, address }) => ({ topics, data, account: { address: emitter ?? address } }));
  }

  function scheduled(zadd: ReturnType<typeof spyZadd>, account: Address = bobAccount) {
    return zadd.mock.calls.filter(([key, , message]) => {
      if (key !== "proposals" || typeof message !== "string") return false;
      const proposalPayload = deserialize(message);
      if (typeof proposalPayload !== "object" || proposalPayload === null) return false;
      return (
        "account" in proposalPayload &&
        proposalPayload.account === account &&
        "nonce" in proposalPayload &&
        proposals.some(({ args }) => args.nonce === proposalPayload.nonce)
      );
    });
  }

  describe("with valid proposals", () => {
    beforeEach(async () => {
      const hashes = await Promise.all(
        [3_000_000n, 4_000_000n].map((amount) =>
          execute(
            encodeFunctionData({
              abi: exaPluginAbi,
              functionName: "propose",
              args: [
                marketUSDCAddress,
                amount,
                ProposalType.Withdraw,
                encodeAbiParameters([{ type: "address" }], [padHex("0x69", { size: 20 })]),
              ],
            }),
          ),
        ),
      );
      proposals = await getLogs(hashes);
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      const unlock = proposals[0]?.args.unlock ?? 0n;
      vi.setSystemTime(new Date(Number(unlock + 10n) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("execute withdraws", async () => {
      const setUser = await spyScopeSetUser();
      const withdraw = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const anotherWithdraw = proposals[1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
      const receiver = getAddress(decodeWithdraw(withdraw.args.data));
      vi.spyOn(ensClient, "getEnsName").mockResolvedValueOnce("alice.eth").mockResolvedValueOnce(null);

      const expected = [
        {
          receiver,
          amount: withdraw.args.amount,
        },
        {
          receiver: getAddress(decodeWithdraw(anotherWithdraw.args.data)),
          amount: anotherWithdraw.args.amount,
        },
      ];
      const proposalExecutions = waitForSuccessfulProposalExecutions([withdraw.args.nonce, anotherWithdraw.args.nonce]);
      const proposalRemovals = waitForProposalRemovals([
        { account: withdraw.args.account, nonce: withdraw.args.nonce },
        { account: anotherWithdraw.args.account, nonce: anotherWithdraw.args.nonce },
      ]);

      const [, receipts, removals] = await Promise.all([
        appClient.index.$post({
          ...withdrawProposal,
          json: {
            ...withdrawProposal.json,
            event: {
              ...withdrawProposal.json.event,
              data: {
                ...withdrawProposal.json.event.data,
                block: {
                  ...withdrawProposal.json.event.data.block,
                  logs: [
                    { topics: withdraw.topics, data: withdraw.data, account: { address: withdraw.address } },
                    {
                      topics: anotherWithdraw.topics,
                      data: anotherWithdraw.data,
                      account: { address: anotherWithdraw.address },
                    },
                  ],
                },
              },
            },
          },
        }),
        proposalExecutions,
        proposalRemovals,
      ]);

      await vi.waitUntil(() => sendPushNotification.mock.calls.length === 2, 26_666);

      expect(sendPushNotification).toHaveBeenCalledWith({
        userId: bobAccount,
        headings: t("Withdraw completed"),
        contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
          amount: f("3"),
          symbol: "USDC",
          recipient: "alice.eth",
        }),
        idempotencyKey: v5(
          `https://exact.ly/proposal/${chain.id}/${withdraw.args.account}/${withdraw.args.nonce}`,
          v5.URL,
        ),
      });
      expect(sendPushNotification).toHaveBeenCalledWith({
        userId: bobAccount,
        headings: t("Withdraw completed"),
        contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
          amount: f("4"),
          symbol: "USDC",
          recipient: shortenHex(receiver),
        }),
        idempotencyKey: v5(
          `https://exact.ly/proposal/${chain.id}/${anotherWithdraw.args.account}/${anotherWithdraw.args.nonce}`,
          v5.URL,
        ),
      });
      expect(hasExpectedTransfers(receipts, expected)).toBe(true);
      expect(removals).toStrictEqual([1, 1]);
      expect(refresh).toHaveBeenCalledWith(database, redis, bobAccount, chain.id);
      expect(setUser).toHaveBeenCalledWith({ id: bobAccount });
    });

    it("ignores proposals emitted by another plugin", async () => {
      const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
      vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
      const zadd = spyZadd();

      const ignored = await post(logs(exaPluginAddress));

      expect(ignored.status).toBe(200);
      expect(scheduled(zadd)).toStrictEqual([]);

      const executions = waitForSuccessfulProposalExecutions(proposals.map(({ args }) => args.nonce));
      const removals = waitForProposalRemovals(proposals.map(({ args }) => args));
      const [response, , removed] = await Promise.all([post(logs()), executions, removals]);
      await vi.waitUntil(() => sendPushNotification.mock.calls.length === proposals.length, 26_666);

      expect(response.status).toBe(200);
      expect(scheduled(zadd)).toHaveLength(proposals.length);
      expect(removed).toStrictEqual(proposals.map(() => 1));
    });

    it("ignores proposals of accounts whose proposal manager lookup reverts", async () => {
      const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
      vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
      const owner = privateKeyToAccount(generatePrivateKey());
      const account = deriveAddress(exaAccountFactoryAddress, { x: padHex(owner.address), y: zeroHash });
      await keeper.exaSend(
        { name: "create account", op: "exa.account" },
        {
          address: exaAccountFactoryAddress,
          abi: exaAccountFactoryAbi,
          functionName: "createAccount",
          args: [0n, [{ x: hexToBigInt(owner.address), y: 0n }]],
        },
      );
      await database.insert(credentials).values({
        id: "proposal-manager-reverts",
        publicKey: new Uint8Array(hexToBytes(owner.address)),
        account,
        factory: exaAccountFactoryAddress,
      });
      const { readContract } = publicClient;
      vi.spyOn(publicClient, "readContract").mockImplementation((parameters) =>
        parameters.functionName === "proposalManager" && parameters.args?.[0] === account
          ? Promise.reject(revertError("proposalManager"))
          : readContract(parameters),
      );
      const zadd = spyZadd();
      const [proposal] = proposals;
      if (!proposal) throw new Error("missing proposal");
      const [signature, , ...indexed] = proposal.topics;
      const executions = waitForSuccessfulProposalExecutions(proposals.map(({ args }) => args.nonce));
      const removals = waitForProposalRemovals(proposals.map(({ args }) => args));

      const [response, , removed] = await Promise.all([
        post([
          {
            topics: [signature, encodeAbiParameters([{ type: "address" }], [account]), ...indexed],
            data: proposal.data,
            account: { address: proposal.address },
          },
          ...logs(),
        ]),
        executions,
        removals,
      ]);
      await vi.waitUntil(() => sendPushNotification.mock.calls.length === proposals.length, 26_666);

      expect(response.status).toBe(200);
      expect(scheduled(zadd)).toHaveLength(proposals.length);
      expect(scheduled(zadd, account)).toStrictEqual([]);
      expect(removed).toStrictEqual(proposals.map(() => 1));
    });

    it.each([
      ["plain", new Error("rpc unavailable")],
      [
        "wrapped",
        getContractError(new HttpRequestError({ url: "http://localhost:8545", details: "rpc unavailable" }), {
          abi: [],
          args: [],
          functionName: "proposalManager",
        }),
      ],
    ])("fails when the proposal manager of an account can't be read (%s error)", async (_, error) => {
      const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
      vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
      const { readContract } = publicClient;
      const read = vi
        .spyOn(publicClient, "readContract")
        .mockImplementation((parameters) =>
          parameters.functionName === "proposalManager" && parameters.args?.[0] === bobAccount
            ? Promise.reject(error)
            : readContract(parameters),
        );
      const zadd = spyZadd();

      const failed = await post(logs());

      expect(failed.status).toBe(500);
      expect(scheduled(zadd)).toStrictEqual([]);
      expect(vi.mocked(captureException).mock.calls.filter(([captured]) => captured === error)).toStrictEqual([]);

      read.mockRestore();
      const executions = waitForSuccessfulProposalExecutions(proposals.map(({ args }) => args.nonce));
      const removals = waitForProposalRemovals(proposals.map(({ args }) => args));
      const [response, , removed] = await Promise.all([post(logs()), executions, removals]);
      await vi.waitUntil(() => sendPushNotification.mock.calls.length === proposals.length, 26_666);

      expect(response.status).toBe(200);
      expect(removed).toStrictEqual(proposals.map(() => 1));
    });

    it("executes withdrawals despite a notification failure", async () => {
      const setUser = await spyScopeSetUser();
      const error = new Error("push failed");
      const sendPushNotification = sendPushNotificationMock.mockResolvedValue({}).mockRejectedValueOnce(error);
      vi.spyOn(ensClient, "getEnsName").mockResolvedValue("alice.eth");
      const executions = waitForSuccessfulProposalExecutions(proposals.map(({ args }) => args.nonce));
      const removals = waitForProposalRemovals(proposals.map(({ args }) => args));

      const [response, receipts, removed] = await Promise.all([
        appClient.index.$post({
          ...withdrawProposal,
          json: {
            ...withdrawProposal.json,
            event: {
              ...withdrawProposal.json.event,
              data: {
                ...withdrawProposal.json.event.data,
                block: {
                  ...withdrawProposal.json.event.data.block,
                  logs: proposals.map(({ topics, data, address }) => ({ topics, data, account: { address } })),
                },
              },
            },
          },
        }),
        executions,
        removals,
      ]);

      expect(response.status).toBe(200);
      expect(await response.json()).toStrictEqual({});
      await vi.waitFor(() => {
        expect(sendPushNotification).toHaveBeenCalledTimes(2);
        expect(captureException).toHaveBeenCalledExactlyOnceWith(error);
      }, 26_666);

      for (const [index, amount] of ["3", "4"].entries()) {
        expect(sendPushNotification).toHaveBeenCalledWith({
          userId: bobAccount,
          headings: t("Withdraw completed"),
          contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
            amount: f(amount),
            symbol: "USDC",
            recipient: "alice.eth",
          }),
          idempotencyKey: v5(
            `https://exact.ly/proposal/${chain.id}/${proposals[index]?.args.account}/${proposals[index]?.args.nonce}`,
            v5.URL,
          ),
        });
      }
      expect(
        hasExpectedTransfers(
          receipts,
          proposals.map(({ args }) => ({ receiver: getAddress(decodeWithdraw(args.data)), amount: args.amount })),
        ),
      ).toBe(true);
      expect(removed).toStrictEqual([1, 1]);
      expect(setUser).toHaveBeenCalledWith({ id: bobAccount });
    });

    it("ignores proposals emitted by another contract", async () => {
      vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
      sendPushNotificationMock.mockResolvedValue({});
      const zadd = spyZadd();

      const response = await post(logs(marketUSDCAddress));

      expect(response.status).toBe(200);
      expect(
        zadd.mock.calls.filter(
          ([key, , member]) => key === "proposals" && proposals.some(({ args }) => member.includes(args.account)),
        ),
      ).toStrictEqual([]);

      const removals = waitForProposalRemovals(proposals.map(({ args }) => args));
      await post(logs());
      await removals;
      await vi.waitUntil(() => sendPushNotificationMock.mock.calls.length === 2, 26_666);
    });

    it.each([
      ["an unknown error", new Error("rpc unavailable")],
      ["an rpc error", new HttpRequestError({ url: "https://rpc.test" })],
    ])("fails until the emitters can be read after %s", async (_, error) => {
      vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
      sendPushNotificationMock.mockResolvedValue({});
      const { readContract } = publicClient;
      const lookup = vi
        .spyOn(publicClient, "readContract")
        .mockImplementation((parameters) =>
          parameters.functionName === "EXA_PLUGIN" ? Promise.reject(error) : readContract(parameters),
        );
      const zadd = spyZadd();
      const currentHook = createBlockHook(defaults);
      const currentClient = testClient(currentHook.app);
      await currentHook.ready.catch(() => undefined);

      const response = await currentClient.index.$post(blockPayloadWith(logs()));

      expect(response.status).toBe(500);
      expect(
        zadd.mock.calls.filter(
          ([key, , member]) => key === "proposals" && proposals.some(({ args }) => member.includes(args.account)),
        ),
      ).toStrictEqual([]);
      lookup.mockRestore();

      const removals = waitForProposalRemovals(proposals.map(({ args }) => args));
      await currentClient.index.$post(blockPayloadWith(logs()));
      await removals;
      await vi.waitUntil(() => sendPushNotificationMock.mock.calls.length === 2, 26_666);
    });
  });

  describe("with a withdraw in the block", () => {
    beforeEach(async () => {
      proposals = await getLogs([await proposeWithdraw(3_000_000n, padHex("0x69", { size: 20 }))]);
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      vi.setSystemTime(new Date(Number((proposals[0]?.args.unlock ?? 0n) + 10n) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("executes the proposal", async () => {
      const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
      vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
      const getSettlements = vi.spyOn(manteca, "getSettlements").mockResolvedValueOnce({ ARS: settlement });
      const getPaymentLock = vi.spyOn(manteca, "getPaymentLock");
      const executions = waitForSuccessfulProposalExecutions(proposals.map(({ args }) => args.nonce));
      const removals = waitForProposalRemovals(proposals.map(({ args }) => args));

      const [response, receipts, removed] = await Promise.all([
        appClient.index.$post(
          withLogs([
            ...proposals.map(({ topics, data, address }) => ({ topics, data, account: { address } })),
            withdrawLog({ receiver: getAddress(padHex("0x69", { size: 20 })), owner: bobAccount }),
          ]),
        ),
        executions,
        removals,
      ]);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({});
      expect(
        hasExpectedTransfers(receipts, [{ receiver: getAddress(padHex("0x69", { size: 20 })), amount: 3_000_000n }]),
      ).toBe(true);
      expect(removed).toStrictEqual([1]);
      expect(getSettlements).toHaveBeenCalledOnce();
      expect(getPaymentLock).not.toHaveBeenCalled();
      expect(setExtra).not.toHaveBeenCalledWith("exa.ignore", true);
      await vi.waitFor(
        () =>
          expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
            userId: bobAccount,
            headings: t("Withdraw completed"),
            contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
              amount: f("3"),
              symbol: "USDC",
              recipient: shortenHex(padHex("0x69", { size: 20 })),
            }),
            idempotencyKey: v5(
              `https://exact.ly/proposal/${chain.id}/${proposals[0]?.args.account}/${proposals[0]?.args.nonce}`,
              v5.URL,
            ),
          }),
        26_666,
      );
    });

    it("executes the proposal when settlements fail", async () => {
      const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
      vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
      const getSettlements = vi.spyOn(manteca, "getSettlements").mockRejectedValueOnce(new Error("manteca down"));
      const executions = waitForSuccessfulProposalExecutions(proposals.map(({ args }) => args.nonce));
      const removals = waitForProposalRemovals(proposals.map(({ args }) => args));

      const [response, receipts, removed] = await Promise.all([
        appClient.index.$post(
          withLogs([
            ...proposals.map(({ topics, data, address }) => ({ topics, data, account: { address } })),
            withdrawLog({ receiver: settlement, owner: bobAccount }),
          ]),
        ),
        executions,
        removals,
      ]);

      expect(response.status).toBe(500);
      expect(
        hasExpectedTransfers(receipts, [{ receiver: getAddress(padHex("0x69", { size: 20 })), amount: 3_000_000n }]),
      ).toBe(true);
      expect(removed).toStrictEqual([1]);
      expect(getSettlements).toHaveBeenCalledOnce();
      expect(setExtra).not.toHaveBeenCalledWith("exa.ignore", true);
      await vi.waitFor(() => expect(sendPushNotification).toHaveBeenCalledOnce(), 26_666);
    });
  });

  describe("with weth withdraw proposal", () => {
    beforeEach(async () => {
      const hash = await proposeWithdraw(69n, padHex("0x69", { size: 20 }), marketWETHAddress);
      proposals = await getLogs([hash]);
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      const unlock = proposals[0]?.args.unlock ?? 0n;
      vi.setSystemTime(new Date(Number(unlock + 10n) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("increments nonce", async () => {
      const withdraw = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
      vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
      const nonceSkip = waitForProposalNonce(withdraw.args.account, withdraw.args.nonce);
      const proposalRemovals = waitForProposalRemovals([
        { account: withdraw.args.account, nonce: withdraw.args.nonce },
      ]);
      const [, removals] = await Promise.all([
        appClient.index.$post({
          ...withdrawProposal,
          json: {
            ...withdrawProposal.json,
            event: {
              ...withdrawProposal.json.event,
              data: {
                ...withdrawProposal.json.event.data,
                block: {
                  ...withdrawProposal.json.event.data.block,
                  logs: [{ topics: withdraw.topics, data: withdraw.data, account: { address: withdraw.address } }],
                },
              },
            },
          },
        }),
        proposalRemovals,
        nonceSkip,
      ]);

      expect(removals).toStrictEqual([1]);
      await expect(
        publicClient.readContract({
          address: withdraw.address,
          abi: proposalManagerAbi,
          functionName: "nonces",
          args: [bobAccount],
        }),
      ).resolves.toBe(withdraw.args.nonce + 1n);
      await vi.waitFor(
        () =>
          expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
            userId: bobAccount,
            headings: t("Withdraw completed"),
            contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
              amount: f(formatUnits(withdraw.args.amount, 18)),
              symbol: "WETH",
              recipient: shortenHex(padHex("0x69", { size: 20 })),
            }),
            idempotencyKey: v5(
              `https://exact.ly/proposal/${chain.id}/${withdraw.args.account}/${withdraw.args.nonce}`,
              v5.URL,
            ),
          }),
        26_666,
      );
    });
  });

  describe("with weth redeem proposal", () => {
    beforeEach(async () => {
      const hash = await proposeWithdraw(69n, padHex("0x69", { size: 20 }), marketWETHAddress, ProposalType.Redeem);
      proposals = await getLogs([hash]);
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      vi.setSystemTime(new Date(Number((proposals[0]?.args.unlock ?? 0n) + 10n) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("increments nonce and notifies redeemed assets", async () => {
      const redeem = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
      vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
      const executions = waitForSuccessfulProposalExecutions([redeem.args.nonce]);
      const removals = waitForProposalRemovals([{ account: redeem.args.account, nonce: redeem.args.nonce }]);

      const [, [receipt], removed] = await Promise.all([
        post([{ topics: redeem.topics, data: redeem.data, account: { address: redeem.address } }]),
        executions,
        removals,
      ]);
      const [withdraw] = parseEventLogs({ abi: marketAbi, eventName: "Withdraw", logs: receipt?.logs ?? [] });
      await vi.waitUntil(() => sendPushNotification.mock.calls.length === 1, 26_666);

      expect(withdraw?.args.shares).toBe(redeem.args.amount);
      expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
        userId: bobAccount,
        headings: t("Withdraw completed"),
        contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
          amount: f(formatUnits(withdraw?.args.assets ?? 0n, 18)),
          symbol: "WETH",
          recipient: shortenHex(padHex("0x69", { size: 20 })),
        }),
        idempotencyKey: v5(`https://exact.ly/proposal/${chain.id}/${redeem.args.account}/${redeem.args.nonce}`, v5.URL),
      });
      expect(removed).toStrictEqual([1]);
      await expect(
        publicClient.readContract({
          address: redeem.address,
          abi: proposalManagerAbi,
          functionName: "nonces",
          args: [bobAccount],
        }),
      ).resolves.toBe(redeem.args.nonce + 1n);
      expect(captureException).not.toHaveBeenCalled();
    });
  });

  describe("with redeem proposal", () => {
    beforeEach(async () => {
      const hash = await proposeWithdraw(
        69_000_000n,
        padHex("0x69", { size: 20 }),
        marketUSDCAddress,
        ProposalType.Redeem,
      );
      proposals = await getLogs([hash]);
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      vi.setSystemTime(new Date(Number((proposals[0]?.args.unlock ?? 0n) + 10n) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("notifies redeemed assets", async () => {
      const redeem = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
      vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
      const executions = waitForSuccessfulProposalExecutions([redeem.args.nonce]);
      const removals = waitForProposalRemovals([{ account: redeem.args.account, nonce: redeem.args.nonce }]);

      const [, [receipt], removed] = await Promise.all([
        post([{ topics: redeem.topics, data: redeem.data, account: { address: redeem.address } }]),
        executions,
        removals,
      ]);
      const [withdraw] = parseEventLogs({ abi: marketAbi, eventName: "Withdraw", logs: receipt?.logs ?? [] });
      await vi.waitUntil(() => sendPushNotification.mock.calls.length === 1, 26_666);

      expect(withdraw?.args.shares).toBe(redeem.args.amount);
      expect(withdraw?.args.assets).toBeGreaterThan(redeem.args.amount);
      expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
        userId: bobAccount,
        headings: t("Withdraw completed"),
        contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
          amount: f(formatUnits(withdraw?.args.assets ?? 0n, 6)),
          symbol: "USDC",
          recipient: shortenHex(padHex("0x69", { size: 20 })),
        }),
        idempotencyKey: v5(`https://exact.ly/proposal/${chain.id}/${redeem.args.account}/${redeem.args.nonce}`, v5.URL),
      });
      expect(removed).toStrictEqual([1]);
    });

    it.each<[string, (receipt: TransactionReceipt) => null | TransactionReceipt, null | string]>([
      ["withdraw logs", (receipt) => ({ ...receipt, logs: [] }), "alice.eth"],
      [
        "withdraw logs from this market and owner",
        (receipt) => ({
          ...receipt,
          logs: receipt.logs.flatMap((log) => {
            const [signature, caller, receiver] = log.topics;
            return signature === toEventSelector(getAbiItem({ abi: marketAbi, name: "Withdraw" })) && caller && receiver
              ? [
                  { ...log, address: marketWETHAddress },
                  {
                    ...log,
                    topics: [signature, caller, receiver, encodeAbiParameters([{ type: "address" }], [zeroAddress])],
                  },
                ]
              : [log];
          }),
        }),
        null,
      ],
      ["receipt", () => null, null],
    ])("reports and notifies without amount when execution has no %s", async (_, synthetic, ensName) => {
      const redeem = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
      vi.spyOn(ensClient, "getEnsName").mockResolvedValue(ensName);
      if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
      const exaSend = keeper.exaSend.bind(keeper);
      let hash: Hash | undefined;
      vi.spyOn(keeper, "exaSend").mockImplementation(async (span, call, options) => {
        const receipt = await exaSend(span, call, options);
        if (call.functionName !== "executeProposal" || !receipt) return receipt;
        const executed = synthetic(receipt);
        hash = executed?.transactionHash;
        return executed;
      });
      const removals = waitForProposalRemovals([{ account: redeem.args.account, nonce: redeem.args.nonce }]);

      const [, removed] = await Promise.all([
        post([{ topics: redeem.topics, data: redeem.data, account: { address: redeem.address } }]),
        removals,
      ]);
      await vi.waitUntil(() => sendPushNotification.mock.calls.length === 1, 26_666);

      expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
        userId: bobAccount,
        headings: t("Withdraw completed"),
        contents: t("{{symbol}} sent to {{recipient}}", {
          symbol: "USDC",
          recipient: ensName ?? shortenHex(padHex("0x69", { size: 20 })),
        }),
        idempotencyKey: v5(`https://exact.ly/proposal/${chain.id}/${redeem.args.account}/${redeem.args.nonce}`, v5.URL),
      });
      expect(captureException).toHaveBeenCalledWith(new Error("missing withdraw event"), {
        level: "error",
        contexts: {
          proposal: {
            account: redeem.args.account,
            chainId: chain.id,
            market: marketUSDCAddress,
            nonce: Number(redeem.args.nonce),
            hash,
          },
        },
      });
      expect(removed).toStrictEqual([1]);
    });
  });

  describe("with reverting proposals", () => {
    beforeEach(async () => {
      const hash = await proposeWithdraw(maxUint256, padHex("0x69", { size: 20 }));
      proposals = await getLogs([hash]);
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      const unlock = proposals[0]?.args.unlock ?? 0n;
      vi.setSystemTime(new Date(Number(unlock + 10n) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("increments nonce", async () => {
      const revert = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const nonceSkip = waitForProposalNonce(revert.args.account, revert.args.nonce);
      const proposalRemovals = waitForProposalRemovals([{ account: revert.args.account, nonce: revert.args.nonce }]);

      const [removals] = await Promise.all([
        proposalRemovals,
        appClient.index.$post({
          ...withdrawProposal,
          json: {
            ...withdrawProposal.json,
            event: {
              ...withdrawProposal.json.event,
              data: {
                ...withdrawProposal.json.event.data,
                block: {
                  ...withdrawProposal.json.event.data.block,
                  logs: [{ topics: revert.topics, data: revert.data, account: { address: revert.address } }],
                },
              },
            },
          },
        }),
        nonceSkip,
      ]);

      expect(removals).toStrictEqual([1]);
      await expect(
        publicClient.readContract({
          address: revert.address,
          abi: proposalManagerAbi,
          functionName: "nonces",
          args: [bobAccount],
        }),
      ).resolves.toBe(revert.args.nonce + 1n);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "execution reverted"] }),
      );
    });

    it("handles NonceTooLow as success in outer catch", async () => {
      const setUser = await spyScopeSetUser();
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const errorAbi = [{ type: "error", name: "NonceTooLow", inputs: [] }] as const;
      const removals = waitForRemovals([match]);
      vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(
          new RawContractError({ data: encodeErrorResult({ abi: errorAbi, errorName: "NonceTooLow" }) }),
          { abi: errorAbi, address: bobAccount, functionName: "executeProposal", args: [proposal.args.nonce] },
        );
      });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      expect(await removals).toStrictEqual([1]);

      expect(vi.mocked(captureException).mock.calls.filter((call) => match.capture(call))).toEqual([]);
      expect(setUser).toHaveBeenCalledWith({ id: bobAccount });
    });

    it("handles NoProposal as success in outer catch", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const removals = waitForRemovals([match]);
      vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(
          new RawContractError({ data: encodeErrorResult({ abi: proposalManagerAbi, errorName: "NoProposal" }) }),
          {
            abi: proposalManagerAbi,
            address: bobAccount,
            functionName: "executeProposal",
            args: [proposal.args.nonce],
          },
        );
      });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      expect(await removals).toStrictEqual([1]);

      expect(vi.mocked(captureException).mock.calls.filter((call) => match.capture(call))).toEqual([]);
    });

    it.each([
      { pending: true, name: "the pending unlock" },
      { pending: false, name: "the next block" },
    ])("requeues Timelocked proposals at $name without nonce skipping", async ({ pending }) => {
      const setUser = await spyScopeSetUser();
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const { readContract, simulateContract } = publicClient;
      const getBlock = vi.spyOn(publicClient, "getBlock");
      if (!pending) {
        vi.spyOn(publicClient, "readContract").mockImplementation((parameters) =>
          parameters.functionName === "pendingProposals" && parameters.args?.[0] === proposal.args.account
            ? Promise.resolve([])
            : readContract(parameters),
        );
      }
      const add: (key: string, score: number, member: string) => Promise<number> = redis.zadd.bind(redis);
      const zadd = vi.spyOn<{ zadd: typeof add }, "zadd">(Redis.prototype, "zadd");
      const removals = waitForRemovals([match]);
      if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
      const exaSend = keeper.exaSend.bind(keeper);
      const exaSendSpy = vi
        .spyOn(keeper, "exaSend")
        .mockImplementation((span, call, options) => exaSend(span, call, options));
      vi.spyOn(publicClient, "simulateContract").mockImplementation((params) => {
        if (params.functionName !== "executeProposal") return simulateContract(params);
        zadd.mockImplementationOnce(async (...args) => {
          await add(...args);
          return add(...args);
        });
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(
          new RawContractError({ data: encodeErrorResult({ abi: proposalManagerAbi, errorName: "Timelocked" }) }),
          { ...params, abi: proposalManagerAbi, args: [proposal.args.nonce] },
        );
      });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      expect(await removals).toStrictEqual([1]);
      const queued = zadd.mock.calls.find(([key, , message]) => {
        if (key !== "proposals" || typeof message !== "string") return false;
        const proposalPayload = deserialize(message);
        if (typeof proposalPayload !== "object" || proposalPayload === null) return false;
        return (
          "account" in proposalPayload &&
          proposalPayload.account === proposal.args.account &&
          "nonce" in proposalPayload &&
          proposalPayload.nonce === proposal.args.nonce &&
          "retryCount" in proposalPayload &&
          proposalPayload.retryCount === 1
        );
      });
      if (!queued || typeof queued[2] !== "string") throw new Error("missing requeued proposal");
      const payload = deserialize(queued[2]);
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("unlock" in payload) ||
        typeof payload.unlock !== "bigint"
      ) {
        throw new Error("missing requeued proposal");
      }
      expect(await redis.zrem("proposals", queued[2])).toBe(1);
      expect(payload.unlock).toBeGreaterThanOrEqual(proposal.args.unlock);
      const proposalCaptureCalls = vi.mocked(captureException).mock.calls.filter((call) => match.capture(call));
      expect(proposalCaptureCalls).toContainEqual([
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "Timelocked"] }),
      ]);
      expect(exaSendSpy.mock.calls.some(([, call]) => call.functionName === "setProposalNonce")).toBe(false);
      expect(getBlock).toHaveBeenCalledTimes(pending ? 1 : 2);
      expect(setUser).toHaveBeenCalledWith({ id: bobAccount });
    });

    it("fingerprints outer catch by reason", async () => {
      const setUser = await spyScopeSetUser();
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const simulateContract = vi.spyOn(publicClient, "simulateContract");
      vi.mocked(continueTrace).mockImplementationOnce(() => {
        throw new ContractFunctionExecutionError(
          new ContractFunctionRevertedError({
            abi: [],
            functionName: "executeProposal",
            message: "execution reverted: proposal outer reason fallback",
          }),
          { abi: [], contractAddress: bobAccount, functionName: "executeProposal", args: [proposal.args.nonce] },
        );
      });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () =>
          vi
            .mocked(captureException)
            .mock.calls.some(
              ([error, hint]) =>
                match.capture([error, hint]) &&
                typeof hint === "object" &&
                "fingerprint" in hint &&
                Array.isArray(hint.fingerprint) &&
                hint.fingerprint.includes("execution reverted: proposal outer reason fallback"),
            ),
        26_666,
      );

      const proposalCaptureCalls = vi.mocked(captureException).mock.calls.filter((call) => match.capture(call));
      const captureExceptionFingerprints = proposalCaptureCalls.flatMap(([, hint]) =>
        typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
      );

      expect(simulateContract).not.toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "executeProposal", args: [proposal.args.nonce] }),
      );
      expect(captureExceptionFingerprints).toEqual([
        ["{{ default }}", "execution reverted: proposal outer reason fallback"],
      ]);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({
          level: "error",
          fingerprint: ["{{ default }}", "execution reverted: proposal outer reason fallback"],
        }),
      );
      expect(setUser).toHaveBeenCalledWith({ id: bobAccount });
    });

    it("fingerprints outer catch by signature", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const simulateContract = vi.spyOn(publicClient, "simulateContract");
      vi.mocked(continueTrace).mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(new RawContractError({ data: "0x12345678" }), {
          abi: [],
          address: bobAccount,
          functionName: "executeProposal",
          args: [proposal.args.nonce],
        });
      });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () =>
          vi
            .mocked(captureException)
            .mock.calls.some(
              ([error, hint]) =>
                match.capture([error, hint]) &&
                typeof hint === "object" &&
                "fingerprint" in hint &&
                Array.isArray(hint.fingerprint) &&
                hint.fingerprint.includes("0x12345678"),
            ),
        26_666,
      );

      const proposalCaptureCalls = vi.mocked(captureException).mock.calls.filter((call) => match.capture(call));
      const captureExceptionFingerprints = proposalCaptureCalls.flatMap(([, hint]) =>
        typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
      );

      expect(simulateContract).not.toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "executeProposal", args: [proposal.args.nonce] }),
      );
      expect(captureExceptionFingerprints).toEqual([["{{ default }}", "0x12345678"]]);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "0x12345678"] }),
      );
    });

    it("fingerprints outer catch as unknown contract revert", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const simulateContract = vi.spyOn(publicClient, "simulateContract");
      vi.mocked(continueTrace).mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(new RawContractError({ data: "0x" }), {
          abi: [],
          address: bobAccount,
          functionName: "executeProposal",
          args: [proposal.args.nonce],
        });
      });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () =>
          vi
            .mocked(captureException)
            .mock.calls.some(
              ([error, hint]) =>
                match.capture([error, hint]) &&
                typeof hint === "object" &&
                "fingerprint" in hint &&
                Array.isArray(hint.fingerprint) &&
                hint.fingerprint.includes("unknown"),
            ),
        26_666,
      );

      const proposalCaptureCalls = vi.mocked(captureException).mock.calls.filter((call) => match.capture(call));
      const captureExceptionFingerprints = proposalCaptureCalls.flatMap(([, hint]) =>
        typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
      );

      expect(simulateContract).not.toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "executeProposal", args: [proposal.args.nonce] }),
      );
      expect(captureExceptionFingerprints).toEqual([["{{ default }}", "unknown"]]);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
      );
    });

    it("fingerprints outer catch as unknown", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const simulateContract = vi.spyOn(publicClient, "simulateContract");
      const error = new Error("nonce reset failed");
      vi.mocked(continueTrace).mockImplementationOnce(() => {
        throw error;
      });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () =>
          vi
            .mocked(captureException)
            .mock.calls.some(
              ([captured, hint]) =>
                captured === error &&
                typeof hint === "object" &&
                "fingerprint" in hint &&
                Array.isArray(hint.fingerprint) &&
                hint.fingerprint.includes("unknown"),
            ),
        26_666,
      );

      const proposalCaptureCalls = vi.mocked(captureException).mock.calls.filter(([captured]) => captured === error);
      const captureExceptionFingerprints = proposalCaptureCalls.flatMap(([, hint]) =>
        typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
      );

      expect(simulateContract).not.toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "executeProposal", args: [proposal.args.nonce] }),
      );
      expect(captureExceptionFingerprints).toEqual([["{{ default }}", "unknown"]]);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "nonce reset failed" }),
        expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
      );
    });

    it("handles recovery NonceTooLow as success", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const errorAbi = [{ type: "error", name: "NonceTooLow", inputs: [] }] as const;
      const removals = waitForRemovals([match]);
      vi.spyOn(publicClient, "simulateContract")
        .mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
          throw getContractError(new RawContractError({ data: "0x" }), {
            abi: [],
            address: bobAccount,
            functionName: "executeProposal",
            args: [proposal.args.nonce],
          });
        })
        .mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
          throw getContractError(
            new RawContractError({ data: encodeErrorResult({ abi: errorAbi, errorName: "NonceTooLow" }) }),
            {
              abi: errorAbi,
              address: bobAccount,
              functionName: "setProposalNonce",
              args: [proposal.args.nonce + 1n],
            },
          );
        });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      expect(await removals).toStrictEqual([1]);

      const recoveryCapture = vi
        .mocked(captureException)
        .mock.calls.find(
          ([error, hint]) =>
            match.capture([error, hint]) &&
            error instanceof Error &&
            "functionName" in error &&
            error.functionName === "setProposalNonce" &&
            typeof hint === "object" &&
            "contexts" in hint,
        );

      expect(recoveryCapture).toBeUndefined();
    });
  });

  describe("with wrapped error", () => {
    beforeEach(async () => {
      const hash = await proposeWithdraw(3_000_000n, padHex("0x69", { size: 20 }));
      proposals = await getLogs([hash]);
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      const unlock = proposals[0]?.args.unlock ?? 0n;
      vi.setSystemTime(new Date(Number(unlock + 10n) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("fingerprints with inner selector", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

      vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(
          new RawContractError({
            data: encodeErrorResult({
              abi: wrappedErrorAbi,
              errorName: "WrappedError",
              args: [zeroAddress, "0x931997cf", "0x", "0x"],
            }),
          }),
          { abi: wrappedErrorAbi, address: bobAccount, functionName: "executeProposal", args: [proposal.args.nonce] },
        );
      });

      const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () => waitForTransactionReceipt.mock.settledResults.some(({ type }) => type !== "incomplete"),
        26_666,
      );

      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError" }),
        expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "WrappedError", "0x931997cf"] }),
      );
    });

    it("fingerprints zero data errors", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

      vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(new RawContractError({ data: "0x" }), {
          abi: [],
          address: bobAccount,
          functionName: "executeProposal",
          args: [proposal.args.nonce],
        });
      });

      const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () => waitForTransactionReceipt.mock.settledResults.some(({ type }) => type !== "incomplete"),
        26_666,
      );

      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError" }),
        expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "unknown"] }),
      );
    });

    it("fingerprints non-contract errors", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

      vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
        throw new Error("test");
      });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () =>
          vi
            .mocked(captureException)
            .mock.calls.some(
              ([error, context]) =>
                error instanceof Error &&
                error.message === "test" &&
                typeof context === "object" &&
                "fingerprint" in context,
            ),
        26_666,
      );

      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "test" }),
        expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
      );
    });

    it("fingerprints unknown signatures", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

      vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(new RawContractError({ data: "0x12345678" }), {
          abi: [],
          address: bobAccount,
          functionName: "executeProposal",
          args: [proposal.args.nonce],
        });
      });

      const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () => waitForTransactionReceipt.mock.settledResults.some(({ type }) => type !== "incomplete"),
        26_666,
      );

      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError" }),
        expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "0x12345678"] }),
      );
    });
  });

  describe.todo("with none proposal", () => {
    beforeEach(async () => {
      const hash = await execute(
        encodeFunctionData({
          abi: exaPluginAbi,
          functionName: "propose",
          args: [marketUSDCAddress, 1n, ProposalType.None, "0x"],
        }),
      );
      proposals = await getLogs([hash]);
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      const unlock = proposals[0]?.args.unlock ?? 0n;
      vi.setSystemTime(new Date(Number(unlock + 10n) * 1000));
    });

    it("increments nonce", async () => {
      const none = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");
      await Promise.all([
        appClient.index.$post({
          ...withdrawProposal,
          json: {
            ...withdrawProposal.json,
            event: {
              ...withdrawProposal.json.event,
              data: {
                ...withdrawProposal.json.event.data,
                block: {
                  ...withdrawProposal.json.event.data.block,
                  logs: [{ topics: none.topics, data: none.data, account: { address: none.address } }],
                },
              },
            },
          },
        }),
        vi.waitUntil(
          () => waitForTransactionReceipt.mock.settledResults.some(({ type }) => type !== "incomplete"),
          6666,
        ),
      ]);

      await expect(
        publicClient.readContract({
          address: none.address,
          abi: proposalManagerAbi,
          functionName: "nonces",
          args: [bobAccount],
        }),
      ).resolves.toBe(none.args.nonce + 1n);
    });
  });

  describe("with idle proposals", () => {
    beforeEach(async () => {
      const hash = await bob.writeContract({
        address: bobAccount,
        functionName: "executeBatch",
        args: [
          [4000n, 5000n, 6000n, 7000n, 8000n, 9000n].map((value) => ({
            target: bobAccount,
            value: 0n,
            data: encodeFunctionData({
              abi: exaPluginAbi,
              functionName: "propose",
              args: [
                marketUSDCAddress,
                value,
                ProposalType.Withdraw,
                encodeAbiParameters([{ type: "address" }], [padHex("0x69", { size: 20 })]),
              ],
            }),
          })),
        ],
        abi: upgradeableModularAccountAbi,
        gas: 6_666_666n,
      });
      proposals = await getLogs([hash]);
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      const maxUnlock = proposals.reduce((max, proposal) => {
        if (proposal.args.unlock > max) return proposal.args.unlock;
        return max;
      }, 0n);
      const block = await anvilClient.getBlock();
      if (block.timestamp <= maxUnlock) {
        await anvilClient.mine({ blocks: 1, interval: Number(maxUnlock - block.timestamp + 1n) });
      }
      vi.setSystemTime(new Date(Number(maxUnlock + 10n) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("executes idle proposals and captures NotNext warning", async () => {
      const setUser = await spyScopeSetUser();
      const idle = proposals[1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const withdraw = proposals[3]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const another = proposals[4]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const pending = proposals[5]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(another.args.account, another.args.nonce);
      const expected = [
        {
          receiver: getAddress(decodeWithdraw(withdraw.args.data)),
          amount: withdraw.args.amount,
        },
        {
          receiver: getAddress(decodeWithdraw(idle.args.data)),
          amount: idle.args.amount,
        },
      ];
      const notNextAbi = [{ type: "error", name: "NotNext", inputs: [] }] as const;
      const { simulateContract } = publicClient;
      let injected = false;
      vi.spyOn(publicClient, "simulateContract").mockImplementation((params) => {
        if (
          !injected &&
          params.functionName === "executeProposal" &&
          params.args?.length === 1 &&
          params.args[0] === another.args.nonce
        ) {
          injected = true;
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
          throw getContractError(
            new RawContractError({ data: encodeErrorResult({ abi: notNextAbi, errorName: "NotNext" }) }),
            { abi: notNextAbi, address: bobAccount, functionName: "executeProposal", args: [another.args.nonce] },
          );
        }
        return simulateContract(params);
      });

      const proposalExecutions = waitForSuccessfulProposalExecutions([
        withdraw.args.nonce,
        idle.args.nonce,
        another.args.nonce,
      ]);
      const notNextCapture = vi.waitUntil(
        () =>
          vi
            .mocked(captureException)
            .mock.calls.filter((call) => match.capture(call))
            .some(
              ([, hint]) =>
                typeof hint === "object" &&
                "fingerprint" in hint &&
                Array.isArray(hint.fingerprint) &&
                hint.fingerprint[1] === "NotNext",
            ),
        26_666,
      );

      const [response, receipts] = await Promise.all([
        appClient.index.$post({
          ...withdrawProposal,
          json: {
            ...withdrawProposal.json,
            event: {
              ...withdrawProposal.json.event,
              data: {
                ...withdrawProposal.json.event.data,
                block: {
                  ...withdrawProposal.json.event.data.block,
                  logs: [
                    { topics: withdraw.topics, data: withdraw.data, account: { address: withdraw.address } },
                    { topics: another.topics, data: another.data, account: { address: another.address } },
                  ],
                },
              },
            },
          },
        }),
        proposalExecutions,
        notNextCapture,
      ]);

      expect(response.status).toBe(200);
      expect(hasExpectedTransfers(receipts, expected)).toBe(true);
      expect(setUser).toHaveBeenCalledWith({ id: bobAccount });
      const proposalCaptureCalls = vi.mocked(captureException).mock.calls.filter((call) => match.capture(call));
      expect(proposalCaptureCalls).toContainEqual([
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "NotNext"] }),
      ]);
      await expect(
        publicClient.readContract({
          address: exaPreviewerAddress,
          abi: exaPreviewerAbi,
          functionName: "pendingProposals",
          args: [bobAccount],
        }),
      ).resolves.toStrictEqual([
        {
          nonce: pending.args.nonce,
          unlock: pending.args.unlock,
          proposal: {
            amount: pending.args.amount,
            market: pending.args.market,
            timestamp: pending.args.unlock - BigInt(deploy.proposalManager.delay[anvil.id]),
            proposalType: pending.args.proposalType,
            data: pending.args.data,
          },
        },
      ]);
    });
  });
});

describe("legacy withdraw", () => {
  const withdrawUnlock = 1000n;
  const owner = privateKeyToAccount(generatePrivateKey());
  const withdrawAccount = deriveAddress(exaAccountFactoryAddress, { x: padHex(owner.address), y: zeroHash });
  const withdrawMarket = getAddress(padHex("0xbeef", { size: 20 }));
  const withdrawReceiver = getAddress(padHex("0xcafe", { size: 20 }));
  const { readContract, simulateContract } = publicClient;

  beforeAll(async () => {
    await keeper.exaSend(
      { name: "create account", op: "exa.account" },
      {
        address: exaAccountFactoryAddress,
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(owner.address), y: 0n }]],
      },
    );
    await database.insert(credentials).values({
      id: "legacy-withdraw",
      publicKey: new Uint8Array(hexToBytes(owner.address)),
      account: withdrawAccount,
      factory: exaAccountFactoryAddress,
    });
  });

  function legacyPayload(amount: bigint, account: Address = withdrawAccount, emitter: Address = exaPluginAddress) {
    return {
      header: {},
      json: {
        type: "GRAPHQL" as const,
        event: {
          data: {
            block: {
              number: 1,
              timestamp: Number(withdrawUnlock),
              logs: [
                {
                  topics: [
                    "0x0c652a21d96e4efed065c3ef5961e4be681be99b95dd55126669ae9be95767e0",
                    encodeAbiParameters([{ type: "address" }], [account]),
                    encodeAbiParameters([{ type: "address" }], [withdrawMarket]),
                    encodeAbiParameters([{ type: "address" }], [withdrawReceiver]),
                  ] as [Hex, ...Hex[]],
                  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [amount, withdrawUnlock]),
                  account: { address: emitter },
                },
              ],
            },
          },
        },
      },
    };
  }

  it("ignores withdrawals emitted by an untrusted contract", async () => {
    const zadd = spyZadd();

    const response = await appClient.index.$post(legacyPayload(1_500_000n, withdrawAccount, zeroAddress));

    expect(response.status).toBe(200);
    expect(
      zadd.mock.calls.filter(([key, , member]) => key === "withdraw" && member.includes(withdrawAccount)),
    ).toStrictEqual([]);
  });

  it("ignores withdrawals from an undeployed account", async () => {
    const zadd = vi.spyOn<{ zadd: (key: string, score: number, member: string) => Promise<number> }, "zadd">(
      Redis.prototype,
      "zadd",
    );

    const undeployed = getAddress(padHex("0xdead", { size: 20 }));
    await database.insert(credentials).values({
      id: "legacy-withdraw-undeployed",
      publicKey: new Uint8Array(hexToBytes(undeployed)),
      account: undeployed,
      factory: exaAccountFactoryAddress,
    });

    const response = await appClient.index.$post(legacyPayload(1_600_000n, undeployed));

    expect(response.status).toBe(200);
    expect(
      zadd.mock.calls.filter(([key, , member]) => key === "withdraw" && member.includes(undeployed)),
    ).toStrictEqual([]);
  });

  it("ignores withdrawals from an account whose plugins read reverts", async () => {
    vi.spyOn(publicClient, "readContract").mockImplementation((parameters) =>
      parameters.functionName === "getInstalledPlugins" && parameters.address === withdrawAccount
        ? Promise.reject(revertError("getInstalledPlugins"))
        : readContract(parameters),
    );
    const zadd = spyZadd();

    const response = await appClient.index.$post(legacyPayload(1_650_000n));

    expect(response.status).toBe(200);
    expect(
      zadd.mock.calls.filter(([key, , member]) => key === "withdraw" && member.includes(withdrawAccount)),
    ).toStrictEqual([]);
  });

  it("fails when the account's plugins can't be read", async () => {
    const error = new Error("rpc unavailable");
    vi.spyOn(publicClient, "readContract").mockImplementation((parameters) =>
      parameters.functionName === "getInstalledPlugins" && parameters.address === withdrawAccount
        ? Promise.reject(error)
        : readContract(parameters),
    );
    const zadd = vi.spyOn<{ zadd: (key: string, score: number, member: string) => Promise<number> }, "zadd">(
      Redis.prototype,
      "zadd",
    );

    const response = await appClient.index.$post(legacyPayload(1_750_000n));

    expect(response.status).toBe(500);
    expect(
      zadd.mock.calls.filter(([key, , member]) => key === "withdraw" && member.includes(withdrawAccount)),
    ).toStrictEqual([]);
    expect(vi.mocked(captureException).mock.calls.filter(([captured]) => captured === error)).toStrictEqual([]);
  });

  it("ignores proposals from unknown accounts", async () => {
    const unknownAccount = getAddress(padHex("0xbad", { size: 20 }));
    const proposed = getAbiItem({ abi: proposalManagerAbi, name: "Proposed" });
    const setAttribute = vi.fn();
    vi.mocked(getActiveSpan).mockReturnValue({ setAttribute } as unknown as ReturnType<typeof getActiveSpan>);
    onTestFinished(() => {
      vi.mocked(getActiveSpan).mockReset();
    });
    const payload = legacyPayload(1n, unknownAccount);
    payload.json.event.data.block.logs.push({
      topics: encodeEventTopics({
        abi: [proposed],
        args: { account: unknownAccount, nonce: 0n, market: withdrawMarket },
      }) as [Hex, ...Hex[]],
      data: encodeAbiParameters(
        proposed.inputs.filter(({ indexed }) => !indexed),
        [ProposalType.Withdraw, 1n, encodeAbiParameters([{ type: "address" }], [unknownAccount]), 1n],
      ),
      account: { address: exaPluginAddress },
    });

    const response = await appClient.index.$post(payload);

    expect(response.status).toBe(200);
    const queued = [...(await redis.zrange("proposals", 0, -1)), ...(await redis.zrange("withdraw", 0, -1))];
    expect(queued.map((message) => deserialize<{ account: string }>(message).account)).not.toContain(unknownAccount);
    expect(setAttribute).toHaveBeenCalledWith("exa.unknown", [unknownAccount]);
    expect(vi.mocked(captureException).mock.calls.filter((call) => inspect(call).includes(unknownAccount))).toEqual([]);
    expect(sendPushNotificationMock).not.toHaveBeenCalledWith(expect.objectContaining({ userId: unknownAccount }));
  });

  async function createFactoryAccount() {
    const signer = privateKeyToAccount(generatePrivateKey());
    const account = deriveAddress(exaAccountFactoryAddress, { x: padHex(signer.address), y: zeroHash });
    await keeper.exaSend(
      { name: "create account", op: "exa.account" },
      {
        address: exaAccountFactoryAddress,
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(signer.address), y: 0n }]],
      },
    );
    return account;
  }

  async function payloadAtHead(amount: bigint, account: Address) {
    const payload = legacyPayload(amount, account);
    payload.json.event.data.block.number = Number(await publicClient.getBlockNumber({ cacheTime: 0 }));
    return payload;
  }

  it("schedules proposals from factory accounts without credentials", async () => {
    const account = await createFactoryAccount();
    const proposed = getAbiItem({ abi: proposalManagerAbi, name: "Proposed" });
    const payload = await payloadAtHead(1n, account);
    payload.json.event.data.block.logs = [
      {
        topics: encodeEventTopics({
          abi: [proposed],
          args: { account, nonce: 0n, market: withdrawMarket },
        }) as [Hex, ...Hex[]],
        data: encodeAbiParameters(
          proposed.inputs.filter(({ indexed }) => !indexed),
          [ProposalType.Withdraw, 1n, encodeAbiParameters([{ type: "address" }], [account]), 1n],
        ),
        account: {
          address: await publicClient.readContract({
            address: exaPluginAddress,
            abi: exaPluginAbi,
            functionName: "proposalManager",
          }),
        },
      },
    ];
    const zadd = spyZadd();

    const response = await appClient.index.$post(payload);

    expect(response.status).toBe(200);
    expect(zadd.mock.calls.filter(([key, , member]) => key === "proposals" && member.includes(account))).toHaveLength(
      1,
    );
  });

  it("schedules withdrawals from factory accounts without a block number", async () => {
    const account = await createFactoryAccount();
    const payload = legacyPayload(1_312_500n, account);
    const { number: _, ...block } = payload.json.event.data.block;
    const zadd = spyZadd();

    const response = await appClient.index.$post({
      ...payload,
      json: { ...payload.json, event: { ...payload.json.event, data: { ...payload.json.event.data, block } } },
    });

    expect(response.status).toBe(200);
    expect(zadd.mock.calls.filter((call) => call[0] === "withdraw" && call[2].includes(account))).toHaveLength(1);
  });

  it("fails without queueing when the rpc is behind the block", async () => {
    const account = await createFactoryAccount();
    const payload = await payloadAtHead(1_375_000n, account);
    payload.json.event.data.block.number += 1000;
    const zadd = spyZadd();

    const response = await appClient.index.$post(payload);

    expect(response.status).toBe(500);
    expect(zadd.mock.calls.filter((call) => call[2].includes(account))).toEqual([]);
  });

  it("fails without queueing when the rpc is behind the block of a credentialed account", async () => {
    const payload = await payloadAtHead(1_406_250n, withdrawAccount);
    payload.json.event.data.block.number += 1000;
    const zadd = spyZadd();

    const response = await appClient.index.$post(payload);

    expect(response.status).toBe(500);
    expect(zadd.mock.calls.filter((call) => call[2].includes(withdrawAccount))).toEqual([]);
  });

  it("schedules withdrawals from factory accounts without credentials", async () => {
    const account = await createFactoryAccount();
    const zadd = spyZadd();
    const setAttribute = vi.fn();
    vi.mocked(getActiveSpan).mockReturnValue({ setAttribute } as unknown as ReturnType<typeof getActiveSpan>);
    onTestFinished(() => {
      vi.mocked(getActiveSpan).mockReset();
    });

    const response = await appClient.index.$post(await payloadAtHead(1_250_000n, account));

    expect(response.status).toBe(200);
    expect(zadd.mock.calls.filter(([key, , member]) => key === "withdraw" && member.includes(account))).toHaveLength(1);
    expect(setAttribute).not.toHaveBeenCalledWith("exa.unknown", expect.anything());
    expect(vi.mocked(captureException).mock.calls.filter((call) => inspect(call).includes(account))).toEqual([]);
  });

  it("fails without queueing when credentials lookup fails", async () => {
    const amount = 1_125_000n;
    vi.spyOn(database.query.credentials, "findMany").mockReturnValueOnce(
      Promise.reject(new Error("credentials lookup failed")) as never,
    );

    const response = await appClient.index.$post(legacyPayload(amount));

    expect(response.status).toBe(500);
    const queued = [...(await redis.zrange("proposals", 0, -1)), ...(await redis.zrange("withdraw", 0, -1))];
    expect(
      queued
        .map((message) => deserialize<{ account: string; amount: bigint }>(message))
        .filter((message) => message.account === withdrawAccount && message.amount === amount),
    ).toEqual([]);
  });

  it("removes withdraw from queue on InsufficientAccountLiquidity", async () => {
    const setUser = await spyScopeSetUser();
    const amount = 1_000_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const removals = waitForRemovals([match]);
    const insufficientAccountLiquidityError = getContractError(
      new RawContractError({
        data: encodeErrorResult({ abi: auditorAbi, errorName: "InsufficientAccountLiquidity" }),
      }),
      { abi: auditorAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
    );
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw insufficientAccountLiquidityError;
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);

    expect(vi.mocked(captureException).mock.calls.filter((call) => match.capture(call))).toEqual([]);
    expect(revertFingerprint(insufficientAccountLiquidityError)).toEqual([
      "{{ default }}",
      "InsufficientAccountLiquidity",
    ]);
    expect(setUser).toHaveBeenCalledWith({ id: withdrawAccount });
  });

  it("removes withdraw from queue on NoProposal", async () => {
    const amount = 1_250_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const removals = waitForRemovals([match]);
    const noProposalError = getContractError(
      new RawContractError({
        data: encodeErrorResult({
          abi: upgradeableModularAccountAbi,
          errorName: "PreExecHookReverted",
          args: [withdrawAccount, 0, encodeErrorResult({ abi: proposalManagerAbi, errorName: "NoProposal" })],
        }),
      }),
      { abi: upgradeableModularAccountAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
    );
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw noProposalError;
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);

    expect(vi.mocked(captureException).mock.calls.filter((call) => match.capture(call))).toEqual([]);
    expect(revertFingerprint(noProposalError)).toEqual(["{{ default }}", "PreExecHookReverted"]);
    expect(
      noProposalError instanceof ContractFunctionExecutionError &&
        noProposalError.cause instanceof ContractFunctionRevertedError &&
        noProposalError.cause.data?.errorName === "PreExecHookReverted" &&
        noProposalError.cause.data.args?.[2] ===
          encodeErrorResult({ abi: proposalManagerAbi, errorName: "NoProposal" }),
    ).toBe(true);
  });

  it("removes withdraw from queue on RuntimeValidationFunctionMissing", async () => {
    const amount = 1_313_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const removals = waitForRemovals([match]);
    const runtimeValidationFunctionMissingError = getContractError(
      new RawContractError({
        data: encodeErrorResult({
          abi: upgradeableModularAccountAbi,
          errorName: "RuntimeValidationFunctionMissing",
          args: ["0x3ccfd60b"],
        }),
      }),
      { abi: upgradeableModularAccountAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
    );
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw runtimeValidationFunctionMissingError;
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);

    expect(vi.mocked(captureException).mock.calls.filter((call) => match.capture(call))).toEqual([]);
    expect(revertFingerprint(runtimeValidationFunctionMissingError)).toEqual([
      "{{ default }}",
      "RuntimeValidationFunctionMissing",
    ]);
  });

  it("sends withdraw notification when keeper returns receipt", async () => {
    const setUser = await spyScopeSetUser();
    const amount = 1_375_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const removals = waitForRemovals([match]);
    const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
    vi.spyOn(ensClient, "getEnsName").mockResolvedValue("alice.eth");
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw"
        ? Promise.resolve({ status: "success" } as TransactionReceipt)
        : exaSend(span, call, options),
    );
    vi.spyOn(publicClient, "readContract").mockImplementation((parameters) => {
      if (parameters.functionName === "getInstalledPlugins") return readContract(parameters);
      if (parameters.functionName === "decimals") return Promise.resolve(6);
      if (parameters.functionName === "symbol") return Promise.resolve("exaUSDC");
      return Promise.reject(new Error("unexpected readContract call"));
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: withdrawAccount,
      headings: t("Withdraw completed"),
      contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
        amount: f("1.375"),
        symbol: "USDC",
        recipient: "alice.eth",
      }),
      idempotencyKey: v5(
        `https://exact.ly/withdraw/${chain.id}/${withdrawAccount}/${withdrawMarket}/${withdrawReceiver}/${amount}/${withdrawUnlock}`,
        v5.URL,
      ),
    });
    expect(vi.mocked(captureException).mock.calls.filter((call) => match.capture(call))).toEqual([]);
    expect(refresh).toHaveBeenCalledWith(database, redis, withdrawAccount, chain.id);
    expect(setUser).toHaveBeenCalledWith({ id: withdrawAccount });
  });

  it("sends withdraw notification with shortened receiver when ens is missing", async () => {
    const amount = 1_375_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const removals = waitForRemovals([match]);
    const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
    vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw"
        ? Promise.resolve({ status: "success" } as TransactionReceipt)
        : exaSend(span, call, options),
    );
    vi.spyOn(publicClient, "readContract").mockImplementation((parameters) => {
      if (parameters.functionName === "getInstalledPlugins") return readContract(parameters);
      if (parameters.functionName === "decimals") return Promise.resolve(6);
      if (parameters.functionName === "symbol") return Promise.resolve("exaUSDC");
      return Promise.reject(new Error("unexpected readContract call"));
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: withdrawAccount,
      headings: t("Withdraw completed"),
      contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
        amount: f("1.375"),
        symbol: "USDC",
        recipient: shortenHex(withdrawReceiver),
      }),
      idempotencyKey: v5(
        `https://exact.ly/withdraw/${chain.id}/${withdrawAccount}/${withdrawMarket}/${withdrawReceiver}/${amount}/${withdrawUnlock}`,
        v5.URL,
      ),
    });
    expect(vi.mocked(captureException).mock.calls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("sends withdraw notification with shortened receiver when ens lookup fails", async () => {
    const amount = 1_375_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const removals = waitForRemovals([match]);
    const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
    vi.spyOn(ensClient, "getEnsName").mockRejectedValue(new Error("ens failed"));
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw"
        ? Promise.resolve({ status: "success" } as TransactionReceipt)
        : exaSend(span, call, options),
    );
    vi.spyOn(publicClient, "readContract").mockImplementation((parameters) => {
      if (parameters.functionName === "getInstalledPlugins") return readContract(parameters);
      if (parameters.functionName === "decimals") return Promise.resolve(6);
      if (parameters.functionName === "symbol") return Promise.resolve("exaUSDC");
      return Promise.reject(new Error("unexpected readContract call"));
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: withdrawAccount,
      headings: t("Withdraw completed"),
      contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
        amount: f("1.375"),
        symbol: "USDC",
        recipient: shortenHex(withdrawReceiver),
      }),
      idempotencyKey: v5(
        `https://exact.ly/withdraw/${chain.id}/${withdrawAccount}/${withdrawMarket}/${withdrawReceiver}/${amount}/${withdrawUnlock}`,
        v5.URL,
      ),
    });
    expect(vi.mocked(captureException).mock.calls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("captures withdraw notification errors", async () => {
    const error = new Error("push failed");
    const amount = 1_375_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const removals = waitForRemovals([match]);
    sendPushNotificationMock.mockImplementation(({ userId }) =>
      userId === withdrawAccount ? Promise.reject(error) : Promise.resolve({}),
    );
    vi.spyOn(ensClient, "getEnsName").mockResolvedValue("alice.eth");
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw"
        ? Promise.resolve({ status: "success" } as TransactionReceipt)
        : exaSend(span, call, options),
    );
    vi.spyOn(publicClient, "readContract").mockImplementation((parameters) => {
      if (parameters.functionName === "getInstalledPlugins") return readContract(parameters);
      if (parameters.functionName === "decimals") return Promise.resolve(6);
      if (parameters.functionName === "symbol") return Promise.resolve("exaUSDC");
      return Promise.reject(new Error("unexpected readContract call"));
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.some(([captured]) => captured === error), 26_666);

    expect(captureException).toHaveBeenCalledWith(error);
  });

  it("removes withdraw from queue when keeper returns reverted receipt", async () => {
    const amount = 1_385_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const removals = waitForRemovals([match]);
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw"
        ? Promise.resolve({ status: "reverted" } as TransactionReceipt)
        : exaSend(span, call, options),
    );

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);

    expect(vi.mocked(captureException).mock.calls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("captures withdraw errors without contract revert details", async () => {
    const amount = 1_625_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const zrem = vi.spyOn(Redis.prototype, "zrem");
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      throw new Error("plain withdraw error");
    });

    await appClient.index.$post(legacyPayload(amount));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              error.message === "plain withdraw error" &&
              typeof hint === "object" &&
              "contexts" in hint,
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "plain withdraw error" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(amount),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "unknown"],
      }),
    );
    expect(zrem.mock.calls.some((call) => match.zrem(call))).toBe(false);
  });

  it("captures withdraw non-error throwables", async () => {
    const amount = 1_626_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const zrem = vi.spyOn(Redis.prototype, "zrem");
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) => {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- validates non-error throwables
      if (call.functionName === "withdraw") return Promise.reject("plain withdraw value");
      return exaSend(span, call, options);
    });

    await appClient.index.$post(legacyPayload(amount));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) => error === "plain withdraw value" && typeof hint === "object" && "contexts" in hint,
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      "plain withdraw value",
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(amount),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "unknown"],
      }),
    );
    expect(zrem.mock.calls.some((call) => match.zrem(call))).toBe(false);
  });

  it("captures keeper errors even when message matches terminal reason", async () => {
    const amount = 1_627_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const zrem = vi.spyOn(Redis.prototype, "zrem");
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    const withdrawSend: () => ReturnType<typeof keeper.exaSend> = () =>
      Promise.reject(new Error("InsufficientAccountLiquidity()"));
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw" ? withdrawSend() : exaSend(span, call, options),
    );

    await appClient.index.$post(legacyPayload(amount));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              error.message === "InsufficientAccountLiquidity()" &&
              typeof hint === "object" &&
              "contexts" in hint,
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "InsufficientAccountLiquidity()" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(amount),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "unknown"],
      }),
    );
    expect(zrem.mock.calls.some((call) => match.zrem(call))).toBe(false);
  });

  it("captures PreExecHookReverted without NoProposal as failed precondition", async () => {
    const amount = 1_955_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const zrem = vi.spyOn(Redis.prototype, "zrem");
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(
        new RawContractError({
          data: encodeErrorResult({
            abi: upgradeableModularAccountAbi,
            errorName: "PreExecHookReverted",
            args: [withdrawAccount, 0, "0x1234"],
          }),
        }),
        { abi: upgradeableModularAccountAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
      );
    });

    await appClient.index.$post(legacyPayload(amount));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              "functionName" in error &&
              error.functionName === "withdraw" &&
              typeof hint === "object" &&
              "contexts" in hint &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("PreExecHookReverted"),
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(amount),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "PreExecHookReverted"],
      }),
    );
    expect(zrem.mock.calls.some((call) => match.zrem(call))).toBe(false);
  });

  it("removes withdraw from queue on terminal revert thrown by keeper", async () => {
    const amount = 1_965_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const removals = waitForRemovals([match]);
    const terminalError = getContractError(
      new RawContractError({
        data: encodeErrorResult({ abi: auditorAbi, errorName: "InsufficientAccountLiquidity" }),
      }),
      { abi: auditorAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
    );
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    const withdrawSend: () => ReturnType<typeof keeper.exaSend> = () => Promise.reject(terminalError as Error);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw" ? withdrawSend() : exaSend(span, call, options),
    );

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);

    expect(vi.mocked(captureException).mock.calls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("removes withdraw from queue on NoProposal thrown by keeper", async () => {
    const amount = 1_975_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const removals = waitForRemovals([match]);
    const noProposalError = getContractError(
      new RawContractError({
        data: encodeErrorResult({
          abi: upgradeableModularAccountAbi,
          errorName: "PreExecHookReverted",
          args: [withdrawAccount, 0, encodeErrorResult({ abi: proposalManagerAbi, errorName: "NoProposal" })],
        }),
      }),
      { abi: upgradeableModularAccountAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
    );
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    const withdrawSend: () => ReturnType<typeof keeper.exaSend> = () => Promise.reject(noProposalError as Error);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw" ? withdrawSend() : exaSend(span, call, options),
    );

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);

    expect(vi.mocked(captureException).mock.calls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("fingerprints withdraw wrapped errors with inner selector", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(
        new RawContractError({
          data: encodeErrorResult({
            abi: wrappedErrorAbi,
            errorName: "WrappedError",
            args: [zeroAddress, "0x931997cf", "0x", "0x"],
          }),
        }),
        { abi: wrappedErrorAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
      );
    });

    await appClient.index.$post(legacyPayload(1_500_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              "functionName" in error &&
              error.functionName === "withdraw" &&
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("WrappedError"),
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(1_500_000n),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "WrappedError", "0x931997cf"],
      }),
    );
  });

  it("fingerprints withdraw revert by reason", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      throw new ContractFunctionExecutionError(
        new ContractFunctionRevertedError({
          abi: [],
          functionName: "withdraw",
          message: "execution reverted: withdraw reason fallback",
        }),
        { abi: [], contractAddress: withdrawAccount, functionName: "withdraw" },
      );
    });

    await appClient.index.$post(legacyPayload(1_600_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              "functionName" in error &&
              error.functionName === "withdraw" &&
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("execution reverted: withdraw reason fallback"),
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(1_600_000n),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "execution reverted: withdraw reason fallback"],
      }),
    );
  });

  it("fingerprints withdraw revert by signature", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(new RawContractError({ data: "0x12345678" }), {
        abi: [],
        address: withdrawAccount,
        functionName: "withdraw",
        args: [],
      });
    });

    await appClient.index.$post(legacyPayload(1_700_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              "functionName" in error &&
              error.functionName === "withdraw" &&
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("0x12345678"),
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(1_700_000n),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "0x12345678"],
      }),
    );
  });

  it("fingerprints withdraw revert by unknown contract data", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(new RawContractError({ data: "0x" }), {
        abi: [],
        address: withdrawAccount,
        functionName: "withdraw",
        args: [],
      });
    });

    await appClient.index.$post(legacyPayload(1_750_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              "functionName" in error &&
              error.functionName === "withdraw" &&
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("unknown"),
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(1_750_000n),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "unknown"],
      }),
    );
  });

  it("fingerprints withdraw revert as unknown", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      throw new Error("withdraw failed");
    });

    await appClient.index.$post(legacyPayload(2_000_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              error.message === "withdraw failed" &&
              typeof hint === "object" &&
              "contexts" in hint,
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "withdraw failed" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(2_000_000n),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "unknown"],
      }),
    );
  });

  it("fingerprints withdraw outer catch with contract revert", async () => {
    const errorAbi = [{ type: "error", name: "Unauthorized", inputs: [] }] as const;
    vi.mocked(continueTrace).mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(
        new RawContractError({
          data: encodeErrorResult({ abi: errorAbi, errorName: "Unauthorized" }),
        }),
        { abi: errorAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
      );
    });

    await appClient.index.$post(legacyPayload(3_000_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([, hint]) =>
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("Unauthorized"),
          ),
      26_666,
    );

    const captureExceptionFingerprints = vi
      .mocked(captureException)
      .mock.calls.flatMap(([, hint]) =>
        typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
      );

    expect(captureExceptionFingerprints).toEqual([["{{ default }}", "Unauthorized"]]);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "Unauthorized"] }),
    );
  });

  it("fingerprints withdraw outer catch by reason", async () => {
    const setUser = await spyScopeSetUser();
    vi.mocked(continueTrace).mockImplementationOnce(() => {
      throw new ContractFunctionExecutionError(
        new ContractFunctionRevertedError({
          abi: [],
          functionName: "withdraw",
          message: "execution reverted: outer withdraw reason fallback",
        }),
        { abi: [], contractAddress: withdrawAccount, functionName: "withdraw" },
      );
    });

    await appClient.index.$post(legacyPayload(3_500_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([, hint]) =>
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("execution reverted: outer withdraw reason fallback"),
          ),
      26_666,
    );

    const captureExceptionFingerprints = vi
      .mocked(captureException)
      .mock.calls.flatMap(([, hint]) =>
        typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
      );

    expect(captureExceptionFingerprints).toEqual([
      ["{{ default }}", "execution reverted: outer withdraw reason fallback"],
    ]);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({
        level: "error",
        fingerprint: ["{{ default }}", "execution reverted: outer withdraw reason fallback"],
      }),
    );
    expect(setUser).toHaveBeenCalledWith({ id: withdrawAccount });
  });

  it("fingerprints withdraw outer catch by signature", async () => {
    vi.mocked(continueTrace).mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(new RawContractError({ data: "0x12345678" }), {
        abi: [],
        address: withdrawAccount,
        functionName: "withdraw",
        args: [],
      });
    });

    await appClient.index.$post(legacyPayload(3_600_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([, hint]) =>
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("0x12345678"),
          ),
      26_666,
    );

    const captureExceptionFingerprints = vi
      .mocked(captureException)
      .mock.calls.flatMap(([, hint]) =>
        typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
      );

    expect(captureExceptionFingerprints).toEqual([["{{ default }}", "0x12345678"]]);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "0x12345678"] }),
    );
  });

  it("fingerprints withdraw outer catch as unknown contract revert", async () => {
    vi.mocked(continueTrace).mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(new RawContractError({ data: "0x" }), {
        abi: [],
        address: withdrawAccount,
        functionName: "withdraw",
        args: [],
      });
    });

    await appClient.index.$post(legacyPayload(3_700_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([, hint]) =>
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("unknown"),
          ),
      26_666,
    );

    const captureExceptionFingerprints = vi
      .mocked(captureException)
      .mock.calls.filter(
        ([error]) => error instanceof ContractFunctionExecutionError && error.functionName === "withdraw",
      )
      .flatMap(([, hint]) =>
        typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
      );

    expect(captureExceptionFingerprints).toEqual([["{{ default }}", "unknown"]]);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
  });

  it("fingerprints withdraw outer catch as unknown", async () => {
    vi.mocked(continueTrace).mockImplementationOnce(() => {
      throw new Error("withdraw outer catch failed");
    });

    await appClient.index.$post(legacyPayload(4_000_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              error.message === "withdraw outer catch failed" &&
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("unknown"),
          ),
      26_666,
    );

    const captureExceptionFingerprints = vi
      .mocked(captureException)
      .mock.calls.flatMap(([, hint]) =>
        typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
      );

    expect(captureExceptionFingerprints).toEqual([["{{ default }}", "unknown"]]);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "withdraw outer catch failed" }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
  });
});

describe("qr payment", () => {
  const payer = deriveAddress(exaAccountFactoryAddress, {
    x: padHex(privateKeyToAddress(padHex("0xa11ce"))),
    y: zeroHash,
  });
  const code = "8d0f05d6-fb17-4adc-8003-de9a0ec9c77a";
  const nonce = BigInt(nonceKey.encode(code)) << 64n;
  const userOpHash = padHex("0x4337", { size: 32 });
  const hash = padHex("0x7e", { size: 32 });
  const lock = {
    code,
    type: "QR3",
    companyId: "68a6270d62a6d9f582f40c00",
    userId: "6adff39f0ee31861fc20cdaf",
    userNumberId: "100114168",
    userExternalId: "Exactly-argentina",
    sender: { exchange: "ARGENTINA", legalId: "30123456", name: "Jane", surname: "Doe" },
    paymentRecipientName: "Ricardo Fort",
    paymentRecipientLegalId: "20505736195",
    paymentAssetAmount: "1706.37",
    paymentAsset: "ARS",
    paymentPrice: "696.70000000",
    paymentAgainstAmount: "2.44921774",
    expireAt: "2026-11-11T11:33:26.000-03:00",
    creationTime: "2026-11-11T11:28:26.096-03:00",
  };
  const synthetic = {
    id: "synthetic",
    numberId: "70009",
    externalId: userOpHash,
    status: "STARTING" as const,
    type: "QR3_PAYMENT",
  };
  const stranger = getAddress(padHex("0x57a", { size: 20 }));
  const payment = withdrawLog({ receiver: settlement, owner: payer, hash });

  beforeAll(async () => {
    await database.insert(credentials).values({
      id: "block-qr",
      publicKey: new Uint8Array(hexToBytes(payer)),
      account: payer,
      factory: exaAccountFactoryAddress,
    });
  });

  it("executes a payment made onchain", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const account = deriveAddress(exaAccountFactoryAddress, { x: padHex(owner.address), y: zeroHash });
    await database.insert(credentials).values({
      id: "block-qr-onchain",
      publicKey: new Uint8Array(hexToBytes(owner.address)),
      account,
      factory: exaAccountFactoryAddress,
    });
    await keeper.exaSend(
      { name: "create account", op: "exa.account" },
      {
        address: exaAccountFactoryAddress,
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(owner.address), y: 0n }]],
      },
    );
    await keeper.exaSend(
      { name: "mint usdc", op: "exa.usdc" },
      {
        address: usdcAddress,
        abi: parseAbi(["function mint(address to, uint256 amount)"]),
        functionName: "mint",
        args: [account, 3_000_000n],
      },
    );
    await keeper.exaSend(
      { name: "poke", op: "exa.poke" },
      { address: account, abi: exaPluginAbi, functionName: "poke", args: [marketUSDCAddress] },
    );
    await anvilClient.setBalance({ address: account, value: 10n ** 18n });
    const userOperation = {
      sender: account,
      nonce: await publicClient.readContract({
        address: entryPoint06Address,
        abi: entryPoint06Abi,
        functionName: "getNonce",
        args: [account, BigInt(nonceKey.encode(code))],
      }),
      initCode: "0x",
      callData: encodeFunctionData({
        abi: upgradeableModularAccountAbi,
        functionName: "execute",
        args: [
          marketUSDCAddress,
          0n,
          encodeFunctionData({ abi: marketAbi, functionName: "withdraw", args: [2_449_218n, settlement, account] }),
        ],
      }),
      callGasLimit: 1_000_000n,
      verificationGasLimit: 1_000_000n,
      preVerificationGas: 100_000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000n,
      paymasterAndData: "0x",
      signature: "0x",
    } as const;
    const receipt = await keeper.exaSend(
      { name: "handle ops", op: "exa.ops" },
      {
        address: entryPoint06Address,
        abi: entryPoint06Abi,
        functionName: "handleOps",
        args: [
          [
            {
              ...userOperation,
              signature: encodePacked(
                ["uint8", "bytes"],
                [
                  0,
                  await owner.signMessage({
                    message: {
                      raw: getUserOperationHash({
                        chainId: chain.id,
                        entryPointAddress: entryPoint06Address,
                        entryPointVersion: "0.6",
                        userOperation,
                      }),
                    },
                  }),
                ],
              ),
            },
          ],
          bob.account.address,
        ],
      },
    );
    if (!receipt) throw new Error("missing receipt");
    const [operation] = parseEventLogs({ abi: entryPoint06Abi, eventName: "UserOperationEvent", logs: receipt.logs });
    const [withdraw] = parseEventLogs({ abi: marketAbi, eventName: "Withdraw", logs: receipt.logs });
    if (!operation || !withdraw) throw new Error("missing logs");
    expect(operation.args).toMatchObject({ sender: account, nonce: userOperation.nonce, success: true });
    expect(withdraw.args).toStrictEqual({
      caller: account,
      receiver: settlement,
      owner: account,
      assets: 2_449_218n,
      shares: withdraw.args.shares,
    });
    const getSettlements = vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock").mockResolvedValueOnce(lock);
    const getAccount = vi.spyOn(persona, "getAccount").mockResolvedValueOnce(basicAccount);
    const getSettlement = vi.spyOn(manteca, "getSettlement").mockResolvedValueOnce(settlement);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment").mockResolvedValueOnce(synthetic);

    const response = await appClient.index.$post(
      withLogs([
        {
          topics: withdraw.topics as [Hex, ...Hex[]],
          data: withdraw.data,
          account: { address: withdraw.address },
          transaction: { hash: receipt.transactionHash },
        },
      ]),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(getSettlements).toHaveBeenCalledTimes(2);
    expect(getPaymentLock).toHaveBeenCalledExactlyOnceWith(code);
    expect(getAccount).toHaveBeenCalledExactlyOnceWith("block-qr-onchain", "basic");
    expect(getSettlement).toHaveBeenCalledExactlyOnceWith("ARS");
    expect(executeQrPayment).toHaveBeenCalledExactlyOnceWith(code, operation.args.userOpHash);
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    expect(setExtra).not.toHaveBeenCalledWith("exa.ignore", true);
  });

  it("pays only the user operations of the payment", async () => {
    const getTransactionReceipt = vi
      .spyOn(publicClient, "getTransactionReceipt")
      .mockResolvedValueOnce(
        transactionReceipt(hash, [
          receiptLog({ receiver: settlement, owner: payer }),
          operationLog({ sender: payer, nonce }),
          operationLog({ sender: stranger, nonce }),
          operationLog({ sender: payer, nonce, address: padHex("0xe4", { size: 20 }) }),
          operationLog({ sender: payer, nonce: 0n }),
        ]),
      );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock").mockResolvedValueOnce(lock);
    vi.spyOn(persona, "getAccount").mockResolvedValueOnce(basicAccount);
    vi.spyOn(manteca, "getSettlement").mockResolvedValueOnce(settlement);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment").mockResolvedValueOnce(synthetic);

    const response = await appClient.index.$post(withLogs([payment, payment]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(getTransactionReceipt).toHaveBeenCalledExactlyOnceWith({ hash });
    expect(getPaymentLock).toHaveBeenCalledExactlyOnceWith(code);
    expect(executeQrPayment).toHaveBeenCalledExactlyOnceWith(code, userOpHash);
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each([
    ["I1234562", "i1234562"],
    ["30.123.456", "30123456"],
    ["1234.5678-A", "12345678a"],
  ])("pays a payer whose document %s manteca returns as %s", async (document, legalId) => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ BRL: settlement });
    mockLock(
      Response.json({
        code,
        type: "PIX",
        companyId: "68a6270d62a6d9f582f40c00",
        userId: "6adff3dadff8e3ababa6f482",
        userNumberId: "100114169",
        userExternalId: "Exactly-brazil",
        sender: { exchange: "ARGENTINA", legalId, name: "ALEXANDER J", surname: "SAMPLE" },
        paymentRecipientName: "TEST USER",
        paymentRecipientLegalId: "123******09",
        paymentAssetAmount: "1.00",
        paymentAsset: "BRL",
        paymentPrice: "5.81800000",
        paymentEffectivePrice: "5.81800004",
        paymentAgainstAmount: "0.17188037",
        paymentAgainst: "USDC",
        expireAt: "2026-11-19T10:08:16.000-03:00",
        creationTime: "2026-11-19T10:03:16.778-03:00",
      }),
    );
    vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
      ...basicAccount,
      attributes: {
        ...basicAccount.attributes,
        fields: {
          ...basicAccount.attributes.fields,
          documents: {
            value: [
              {
                value: {
                  id_class: { value: "id" },
                  id_number: { value: document },
                  id_issuing_country: { value: "AR" },
                  id_document_id: { value: "doc_id" },
                },
              },
            ],
          },
        },
      },
    });
    const getSettlement = vi.spyOn(manteca, "getSettlement").mockResolvedValueOnce(settlement);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment").mockResolvedValueOnce(synthetic);

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(getSettlement).toHaveBeenCalledExactlyOnceWith("BRL");
    expect(executeQrPayment).toHaveBeenCalledExactlyOnceWith(code, userOpHash);
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("executes once when the hook redelivers the payment", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValue(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    vi.spyOn(manteca, "getPaymentLock").mockResolvedValue(lock);
    vi.spyOn(persona, "getAccount").mockResolvedValue(basicAccount);
    vi.spyOn(manteca, "getSettlement").mockResolvedValue(settlement);
    const { fetch: realFetch } = globalThis;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (input === "https://manteca.test/crypto/v2/synthetics/qr-payment") {
        return Promise.resolve(
          fetch.mock.calls.some(([url], index, calls) => url === input && index < calls.length - 1)
            ? Response.json({ internalStatus: "SYNTHETIC_EXISTS", message: "Synthetic exists" }, { status: 409 })
            : Response.json(synthetic),
        );
      }
      if (input === `https://manteca.test/crypto/v2/synthetics/${userOpHash}`) {
        return Promise.resolve(Response.json(synthetic));
      }
      return realFetch(input, init);
    });

    const first = await appClient.index.$post(withLogs([payment]));
    const second = await appClient.index.$post(withLogs([payment]));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const executions = fetch.mock.calls.filter(
      ([url]) => url === "https://manteca.test/crypto/v2/synthetics/qr-payment",
    );
    expect(executions.map(([, init]) => init?.body)).toStrictEqual([
      JSON.stringify({ qrCode: code, externalId: userOpHash }),
      JSON.stringify({ qrCode: code, externalId: userOpHash }),
    ]);
    expect(fetch).toHaveBeenCalledWith(
      `https://manteca.test/crypto/v2/synthetics/${userOpHash}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a payment below the lock amount",
      { assets: 2_449_217n },
      basicAccount,
      lock,
      { amount: "2449217", cause: "amount", assets: "2449217", lock: "2.44921774" },
    ],
    [
      "another payer",
      {},
      basicAccount,
      { ...lock, sender: { ...lock.sender, legalId: "99999999" } },
      { cause: "payer", persona: "act_qr" },
    ],
    ["a payer without national id", {}, passportAccount, lock, { cause: "payer", persona: "act_qr" }],
    ["a payer without persona account", {}, undefined, lock, { cause: "payer" }],
    ["a lock without sender", {}, basicAccount, { ...lock, sender: undefined }, { cause: "payer", persona: "act_qr" }],
  ] as const)("reports %s without executing", async (_, override, account, paymentLock, details) => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer, ...override }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    vi.spyOn(manteca, "getPaymentLock").mockResolvedValueOnce(paymentLock);
    const getAccount = vi.spyOn(persona, "getAccount").mockResolvedValueOnce(account);
    vi.spyOn(manteca, "getSettlement").mockResolvedValueOnce(settlement);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(getAccount).toHaveBeenCalledExactlyOnceWith("block-qr", "basic");
    expect(executeQrPayment).not.toHaveBeenCalled();
    expect(core.captureException).toHaveBeenCalledExactlyOnceWith(new Error("qr payment not executed"), {
      level: "error",
      contexts: { payment: { account: payer, userOpHash, amount: "2449218", ...details } },
    });
  });

  it("reports a payment without the lock in the nonce key", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce: 0n }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(getPaymentLock).not.toHaveBeenCalled();
    expect(core.captureException).toHaveBeenCalledExactlyOnceWith(
      new Error("usdc sent to settlement without qr lock"),
      {
        level: "error",
        contexts: { payment: { account: payer, userOpHash, amount: "2449218" } },
      },
    );
    expect(core.captureException).not.toHaveBeenCalledWith(new Error("qr payment not executed"), expect.anything());
  });

  it.each([
    ["receiver", { receiver: stranger }],
    ["owner", { owner: stranger }],
    ["market", { address: marketWETHAddress }],
  ] as const)("ignores a payment to the wrong %s without reporting", async (_, override) => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer, ...override }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    vi.spyOn(manteca, "getPaymentLock").mockResolvedValueOnce(lock);
    vi.spyOn(persona, "getAccount").mockResolvedValueOnce(basicAccount);
    vi.spyOn(manteca, "getSettlement").mockResolvedValueOnce(settlement);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(executeQrPayment).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("ignores a failed user operation before reading the lock", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce, success: false }),
      ]),
    );
    const getSettlements = vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(getSettlements).toHaveBeenCalledOnce();
    expect(getPaymentLock).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
  });

  it("ignores a payment whose lock expired after the execute", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    vi.spyOn(manteca, "getPaymentLock").mockResolvedValueOnce(null);
    const getSynthetic = vi.spyOn(manteca, "getSynthetic").mockResolvedValueOnce({ ...synthetic, status: "COMPLETED" });
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(getSynthetic).toHaveBeenCalledExactlyOnceWith(userOpHash);
    expect(executeQrPayment).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
  });

  it("fails a payment when the receipt lookup fails for redelivery", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockRejectedValueOnce(new Error("rpc down"));
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(500);
    expect(getPaymentLock).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
  });

  it("ignores withdraws that are not payments", async () => {
    const getTransactionReceipt = vi.spyOn(publicClient, "getTransactionReceipt");
    const getSettlements = vi.spyOn(manteca, "getSettlements").mockResolvedValueOnce({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock");

    const response = await appClient.index.$post(
      withLogs([
        withdrawLog({ receiver: getAddress(padHex("0xca7d", { size: 20 })), owner: payer, hash }),
        { ...withdrawLog({ receiver: settlement, owner: payer, hash }), account: { address: marketWETHAddress } },
      ]),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(setExtra).toHaveBeenCalledWith("exa.ignore", true);
    expect(getSettlements).toHaveBeenCalledOnce();
    expect(getTransactionReceipt).not.toHaveBeenCalled();
    expect(getPaymentLock).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("fails withdraws when settlements fail for redelivery", async () => {
    vi.spyOn(manteca, "getSettlements").mockRejectedValueOnce(new Error("manteca down"));
    const getTransactionReceipt = vi.spyOn(publicClient, "getTransactionReceipt");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(500);
    expect(setExtra).not.toHaveBeenCalledWith("exa.ignore", true);
    expect(getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("reports payments without a user operation of a known account", async () => {
    const other = padHex("0x7f", { size: 32 });
    const direct = padHex("0x7e1", { size: 32 });
    const getTransactionReceipt = vi
      .spyOn(publicClient, "getTransactionReceipt")
      .mockResolvedValueOnce(transactionReceipt(other, [operationLog({ sender: stranger, nonce })]))
      .mockResolvedValueOnce(transactionReceipt(direct, [receiptLog({ receiver: settlement, owner: payer })]));
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock");

    const response = await appClient.index.$post(
      withLogs([
        { ...payment, transaction: undefined },
        withdrawLog({ receiver: settlement, owner: stranger, hash: other }),
        withdrawLog({ receiver: settlement, owner: payer, hash: direct, assets: 1_000_000n }),
      ]),
    );

    expect(response.status).toBe(200);
    expect(getTransactionReceipt).toHaveBeenCalledTimes(2);
    expect(getTransactionReceipt).toHaveBeenCalledWith({ hash: other });
    expect(getTransactionReceipt).toHaveBeenCalledWith({ hash: direct });
    expect(getPaymentLock).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledTimes(3);
    expect(captureException).toHaveBeenCalledWith(new Error("usdc sent to settlement without qr lock"), {
      level: "error",
      contexts: { payment: { account: payer, transaction: undefined, amount: "2449218" } },
    });
    expect(captureException).toHaveBeenCalledWith(new Error("usdc sent to settlement without qr lock"), {
      level: "error",
      contexts: { payment: { account: stranger, transaction: other, amount: "2449218" } },
    });
    expect(captureException).toHaveBeenCalledWith(new Error("usdc sent to settlement without qr lock"), {
      level: "error",
      contexts: { payment: { account: payer, transaction: direct, amount: "1000000" } },
    });
  });

  it("fails a payment for redelivery", async () => {
    const error = new Error("lock lookup failed");
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    vi.spyOn(manteca, "getPaymentLock").mockRejectedValueOnce(error);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(500);
    expect(executeQrPayment).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      contexts: { payment: { account: payer, userOpHash } },
    });
  });

  it("pays the next user operation of the bundle after a failure", async () => {
    const error = new Error("lock lookup failed");
    const next = deriveAddress(exaAccountFactoryAddress, {
      x: padHex(privateKeyToAddress(generatePrivateKey())),
      y: zeroHash,
    });
    await database.insert(credentials).values({
      id: "block-qr-next",
      publicKey: new Uint8Array(hexToBytes(next)),
      account: next,
      factory: exaAccountFactoryAddress,
    });
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
        receiptLog({ receiver: settlement, owner: next }),
        operationLog({ sender: next, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock").mockRejectedValueOnce(error).mockResolvedValueOnce(lock);
    const getAccount = vi.spyOn(persona, "getAccount").mockResolvedValueOnce(basicAccount);
    vi.spyOn(manteca, "getSettlement").mockResolvedValueOnce(settlement);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment").mockResolvedValueOnce(synthetic);

    const response = await appClient.index.$post(
      withLogs([payment, withdrawLog({ receiver: settlement, owner: next, hash })]),
    );

    expect(response.status).toBe(500);
    expect(getPaymentLock).toHaveBeenCalledTimes(2);
    expect(getAccount).toHaveBeenCalledExactlyOnceWith("block-qr-next", "basic");
    expect(executeQrPayment).toHaveBeenCalledExactlyOnceWith(code, userOpHash);
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      contexts: { payment: { account: payer, userOpHash } },
    });
  });

  it("reports a payment the lock rejects", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    vi.spyOn(manteca, "getPaymentLock").mockResolvedValueOnce(null);
    vi.spyOn(manteca, "getSynthetic").mockResolvedValueOnce(null);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(executeQrPayment).not.toHaveBeenCalled();
    expect(core.captureException).toHaveBeenCalledExactlyOnceWith(new Error("qr payment not executed"), {
      level: "error",
      contexts: { payment: { account: payer, userOpHash, amount: "2449218", cause: "expired" } },
    });
  });

  it("reports a payment with an unknown lock code", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    mockLock(Response.json({ internalStatus: "PAYMENT_LOCK_NF" }, { status: 404 }));
    const getSynthetic = vi.spyOn(manteca, "getSynthetic").mockResolvedValueOnce(null);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(getSynthetic).toHaveBeenCalledExactlyOnceWith(userOpHash);
    expect(executeQrPayment).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    expect(core.captureException).toHaveBeenCalledExactlyOnceWith(new Error("qr payment not executed"), {
      level: "error",
      contexts: { payment: { account: payer, userOpHash, amount: "2449218", cause: "lock" } },
    });
  });

  it("fails a payment for redelivery when manteca fails", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    mockLock(new Response("internal", { status: 500 }));
    const getSynthetic = vi.spyOn(manteca, "getSynthetic");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(500);
    expect(getSynthetic).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.any(ServiceError), {
      level: "error",
      contexts: { payment: { account: payer, userOpHash } },
    });
  });

  function mockLock(response: Response) {
    const { fetch } = globalThis;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
      input === `https://manteca.test/crypto/v2/payment-locks/${code}` ? Promise.resolve(response) : fetch(input, init),
    );
  }
});

const blockPayload = {
  header: {},
  json: {
    type: "GRAPHQL" as const,
    event: { data: { block: { number: 666, timestamp: Math.floor(Date.now() / 1000), logs: [] } } },
  },
};

const withdrawProposal = {
  header: {},
  json: {
    webhookId: "webhookId",
    id: "eventId",
    createdAt: "2025-02-28T20:04:49.443359731Z",
    type: "GRAPHQL" as const,
    event: {
      data: {
        block: {
          number: 1,
          timestamp: 1_740_771_568,
          logs: [{ topics: [], data: "0x", account: { address: zeroAddress } }],
        },
      },
      sequenceNumber: "10000000000578619000",
      network: "ANVIL",
    },
  },
};

function revertError(functionName: string) {
  return new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi: [], functionName }), {
    abi: [],
    functionName,
  });
}

function hasExpectedTransfers(
  receipts: readonly TransactionReceipt[],
  expected: { amount: bigint; receiver: Address }[],
) {
  const transferred = receipts
    .flatMap((receipt) =>
      receipt.logs
        .filter((l) => l.address.toLowerCase() === usdcAddress.toLowerCase())
        .map((l) => decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: l.topics, data: l.data }))
        .map((l) => ({ receiver: getAddress(l.args.to), amount: l.args.value })),
    )
    .filter(({ amount }) => amount > 0n);
  const transferCountByKey = new Map<string, number>();
  for (const transfer of transferred) {
    const key = `${transfer.receiver}:${transfer.amount}`;
    transferCountByKey.set(key, (transferCountByKey.get(key) ?? 0) + 1);
  }
  for (const transfer of expected) {
    const key = `${transfer.receiver}:${transfer.amount}`;
    const count = transferCountByKey.get(key) ?? 0;
    if (count === 0) return false;
    transferCountByKey.set(key, count - 1);
  }
  return true;
}

async function waitForSuccessfulProposalExecutions(expectedNonces: bigint[]) {
  if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
  const exaSend = keeper.exaSend.bind(keeper);
  const expected = new Set(expectedNonces);
  const successfulReceipts = new Map<bigint, TransactionReceipt>();
  const failures = new Map<bigint, unknown>();
  vi.spyOn(keeper, "exaSend").mockImplementation(async (span, call, options) => {
    const nonce =
      call.functionName === "executeProposal" &&
      call.args?.length === 1 &&
      typeof call.args[0] === "bigint" &&
      expected.has(call.args[0])
        ? call.args[0]
        : undefined;
    const receipt = await exaSend(span, call, options).catch((error: unknown) => {
      if (nonce !== undefined) failures.set(nonce, error);
      throw error;
    });
    if (nonce !== undefined && receipt?.status === "success") successfulReceipts.set(nonce, receipt);
    return receipt;
  });
  await vi.waitUntil(() => expectedNonces.every((nonce) => successfulReceipts.has(nonce)), 26_666).catch(() => null);
  return expectedNonces.map((nonce) => {
    const receipt = successfulReceipts.get(nonce);
    if (!receipt)
      throw new Error(`missing successful receipt for nonce ${String(nonce)}`, { cause: failures.get(nonce) });
    return receipt;
  });
}

function waitForProposalNonce(account: Address, nonce: bigint) {
  const settled = Promise.withResolvers<boolean>();
  if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
  const exaSend = keeper.exaSend.bind(keeper);
  vi.spyOn(keeper, "exaSend").mockImplementation(async (span, call, options) => {
    const matched =
      call.functionName === "setProposalNonce" &&
      call.address.toLowerCase() === account.toLowerCase() &&
      call.args?.[0] === nonce + 1n;
    try {
      const receipt = await exaSend(span, call, options);
      if (matched) settled.resolve(true);
      return receipt;
    } catch (error) {
      if (matched) settled.reject(error);
      throw error;
    }
  });
  return settled.promise;
}

function waitForProposalRemovals(expected: { account: Address; nonce: bigint }[]) {
  return waitForRemovals(expected.map(({ account, nonce }) => matchProposal(account, nonce)));
}

function waitForRemovals(matches: { zrem(args: unknown[]): boolean }[]) {
  const remove = redis.zrem.bind(redis);
  const removals = matches.map((match) => ({
    ...Promise.withResolvers<number>(),
    match,
  }));
  vi.spyOn(Redis.prototype, "zrem").mockImplementation(async (...args) => {
    const removal = removals.find(({ match }) => match.zrem(args));
    try {
      const count = await remove(...args);
      removal?.resolve(count);
      return count;
    } catch (error) {
      removal?.reject(error);
      throw error;
    }
  });
  return Promise.all(removals.map(({ promise }) => promise));
}

function execute(calldata: Hex) {
  return bob.writeContract({
    address: bobAccount,
    functionName: "execute",
    args: [bobAccount, 0n, calldata],
    abi: [...exaPluginAbi, ...issuerCheckerAbi, ...upgradeableModularAccountAbi, ...auditorAbi, ...marketAbi],
    gas: 6_666_666n,
  });
}

function proposeWithdraw(
  amount: bigint,
  receiver: Address,
  market: Address = marketUSDCAddress,
  proposalType: ProposalType.Redeem | ProposalType.Withdraw = ProposalType.Withdraw,
) {
  return execute(
    encodeFunctionData({
      abi: exaPluginAbi,
      functionName: "propose",
      args: [market, amount, proposalType, encodeAbiParameters([{ type: "address" }], [receiver])],
    }),
  );
}

async function getLogs(hashes: Hex[]) {
  const receipts = await Promise.all(hashes.map((hash) => anvilClient.waitForTransactionReceipt({ hash })));
  return parseEventLogs<typeof proposalManagerAbi, true, "Proposed">({
    logs: receipts.flatMap((r) => r.logs),
    abi: proposalManagerAbi,
    eventName: "Proposed",
    strict: true,
  });
}

function withLogs(
  logs: { account: { address: Address }; data: Hex; topics: [Hex, ...Hex[]]; transaction?: { hash: Hex } }[],
) {
  return {
    ...withdrawProposal,
    json: {
      ...withdrawProposal.json,
      event: {
        ...withdrawProposal.json.event,
        data: { ...withdrawProposal.json.event.data, block: { ...withdrawProposal.json.event.data.block, logs } },
      },
    },
  };
}

function withdrawLog({
  receiver,
  owner,
  hash,
  assets = 2_449_218n,
}: {
  assets?: bigint;
  hash?: Hex;
  owner: Address;
  receiver: Address;
}) {
  return {
    topics: encodeEventTopics({ abi: marketAbi, eventName: "Withdraw", args: { caller: owner, receiver, owner } }) as [
      Hex,
      ...Hex[],
    ],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [assets, assets]),
    account: { address: marketUSDCAddress },
    ...(hash && { transaction: { hash } }),
  };
}

function receiptLog({
  receiver,
  owner,
  assets,
  address = marketUSDCAddress,
}: {
  address?: Address;
  assets?: bigint;
  owner: Address;
  receiver: Address;
}) {
  const { topics, data } = withdrawLog({ receiver, owner, assets });
  return { address, topics, data };
}

function operationLog({
  sender,
  nonce,
  address = entryPoint06Address,
  success = true,
}: {
  address?: Address;
  nonce: bigint;
  sender: Address;
  success?: boolean;
}) {
  return {
    address,
    topics: encodeEventTopics({
      abi: entryPoint06Abi,
      eventName: "UserOperationEvent",
      args: { userOpHash: padHex("0x4337", { size: 32 }), sender, paymaster: zeroAddress },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
      [nonce, success, 0n, 0n],
    ),
  };
}

function transactionReceipt(hash: Hex, logs: ReturnType<typeof operationLog>[]): TransactionReceipt {
  return {
    blockHash: zeroHash,
    blockNumber: 1n,
    contractAddress: null,
    cumulativeGasUsed: 0n,
    effectiveGasPrice: 0n,
    from: zeroAddress,
    gasUsed: 0n,
    logs: logs.map((log, logIndex) => ({
      ...log,
      blockHash: zeroHash,
      blockNumber: 1n,
      logIndex,
      transactionHash: hash,
      transactionIndex: 0,
      removed: false,
    })),
    logsBloom: "0x",
    status: "success",
    to: entryPoint06Address,
    transactionHash: hash,
    transactionIndex: 0,
    type: "eip1559",
  };
}

const withdrawTopic = toEventSelector(getAbiItem({ abi: marketAbi, name: "Withdraw" }));

const basicAccount = {
  id: "act_qr",
  type: "account" as const,
  attributes: {
    "country-code": "AR",
    "email-address": "jane@example.com",
    "name-first": "Jane",
    "name-middle": null,
    "name-last": "Doe",
    "address-street-1": "123 Main St",
    "address-street-2": null,
    "address-city": "Buenos Aires",
    "address-subdivision": "CABA", // cspell:ignore CABA
    "address-postal-code": "1000",
    "social-security-number": null,
    "phone-number": "+5491123456789",
    birthdate: "1990-01-01",
    fields: {
      name: { value: { first: { value: "Jane" }, middle: { value: null }, last: { value: "Doe" } } },
      address: {
        value: {
          street_1: { value: "123 Main St" },
          street_2: { value: null },
          city: { value: "Buenos Aires" },
          subdivision: { value: "CABA" },
          postal_code: { value: "1000" },
          country_code: { value: "AR" },
        },
      },
      birthdate: { value: "1990-01-01" },
      phone_number: { value: "+5491123456789" },
      email_address: { value: "jane@example.com" },
      selfie_photo: { value: { filename: "selfie.jpg", url: "https://example.com/selfie.jpg" } },
      rain_e_sign_consent: { value: true },
      exa_card_tc: { value: true },
      privacy__policy: { value: true },
      account_opening_disclosure: { value: null },
      economic_activity: { value: "Developer" },
      annual_salary: { value: "50000" },
      expected_monthly_volume: { value: "1000" },
      accurate_info_confirmation: { value: true },
      non_unauthorized_solicitation: { value: true },
      non_illegal_activities_2: { value: "No" as const },
      documents: {
        value: [
          {
            value: {
              id_class: { value: "id" },
              id_number: { value: "30123456" },
              id_issuing_country: { value: "AR" },
              id_document_id: { value: "doc_id" },
            },
          },
        ],
      },
    },
  },
};

const passportAccount = {
  ...basicAccount,
  attributes: {
    ...basicAccount.attributes,
    fields: {
      ...basicAccount.attributes.fields,
      documents: {
        value: [
          {
            value: {
              id_class: { value: "pp" },
              id_number: { value: "AAA123456" },
              id_issuing_country: { value: "AR" },
              id_document_id: { value: "doc_pp" },
            },
          },
        ],
      },
    },
  },
};

afterEach(() => vi.restoreAllMocks());

vi.mock("@sentry/core", { spy: true });
vi.mock("@sentry/node", { spy: true });
vi.mock("../../utils/liquidity", { spy: true });

const wrappedErrorAbi = [
  {
    type: "error",
    name: "WrappedError",
    inputs: [
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
      { name: "reason", type: "bytes" },
      { name: "details", type: "bytes" },
    ],
  },
] as const;

function matchProposal(account: Address, nonce: bigint) {
  return {
    capture([error, hint]: unknown[]) {
      if (typeof hint === "object" && hint !== null && "contexts" in hint) {
        const contexts = (hint as { contexts?: unknown }).contexts;
        if (typeof contexts === "object" && contexts !== null && "proposal" in contexts) {
          const proposal = (contexts as { proposal?: unknown }).proposal;
          return (
            typeof proposal === "object" &&
            proposal !== null &&
            "account" in proposal &&
            proposal.account === account &&
            "nonce" in proposal &&
            proposal.nonce === Number(nonce)
          );
        }
      }
      return (
        typeof error === "object" &&
        error !== null &&
        "functionName" in error &&
        error.functionName === "executeProposal" &&
        "contractAddress" in error &&
        (error.contractAddress as string).toLowerCase() === account.toLowerCase() &&
        "args" in error &&
        Array.isArray(error.args) &&
        error.args[0] === nonce
      );
    },
    zrem([key, message]: unknown[]) {
      if (key !== "proposals" || typeof message !== "string") return false;
      const payload = deserialize(message);
      if (typeof payload !== "object" || payload === null) return false;
      return "account" in payload && payload.account === account && "nonce" in payload && payload.nonce === nonce;
    },
  };
}

function matchWithdraw(amount: bigint, account: Address, market: Address, receiver: Address) {
  return {
    capture([, hint]: unknown[]) {
      if (typeof hint !== "object" || hint === null || !("contexts" in hint)) return false;
      const contexts = (hint as { contexts?: unknown }).contexts;
      if (typeof contexts !== "object" || contexts === null || !("withdraw" in contexts)) return false;
      const withdraw = (contexts as { withdraw?: unknown }).withdraw;
      return (
        typeof withdraw === "object" &&
        withdraw !== null &&
        "account" in withdraw &&
        withdraw.account === account &&
        "market" in withdraw &&
        withdraw.market === market &&
        "receiver" in withdraw &&
        withdraw.receiver === receiver &&
        "amount" in withdraw &&
        withdraw.amount === String(amount)
      );
    },
    zrem([key, message]: unknown[]) {
      if (key !== "withdraw" || typeof message !== "string") return false;
      const payload = deserialize(message);
      if (typeof payload !== "object" || payload === null) return false;
      return (
        "account" in payload &&
        payload.account === account &&
        "market" in payload &&
        payload.market === market &&
        "receiver" in payload &&
        payload.receiver === receiver &&
        "amount" in payload &&
        payload.amount === amount
      );
    },
  };
}

async function spyScopeSetUser() {
  const { withScope: realWithScope } = await vi.importActual<typeof sentry>("@sentry/node");
  const setUser = vi.fn();
  vi.mocked(withScope).mockImplementation((_scopeOrCallback, _callback?) =>
    realWithScope((scope) => {
      const originalSetUser = scope.setUser.bind(scope);
      scope.setUser = (...args: Parameters<typeof scope.setUser>) => {
        setUser(...args);
        return originalSetUser(...args);
      };
      return ((_callback ?? _scopeOrCallback) as NonNullable<typeof _callback>)(scope);
    }),
  );
  return setUser;
}

const legacyFactory = getAddress("0x8D493AF799162Ac3f273e8918B2842447f702163");
const legacyFactoryPlugin = getAddress("0xBeE265c71EDdaEfa035b6966D8f744261E5dd182");
const legacyPlugins = [
  getAddress("0x2Bbaf52f13513CE325066D387c1dA1F260c26887"),
  getAddress("0x87aF7e4892e47a7De34dF689bA5f3bCccED3e5DE"),
] as const;

async function factoryEmitters() {
  const plugins = await Promise.all(
    factories.versions.map((address) =>
      publicClient.readContract({ address, abi: exaAccountFactoryAbi, functionName: "EXA_PLUGIN" }),
    ),
  );
  const managers = await Promise.all(
    plugins.map((address) =>
      publicClient.readContract({ address, abi: exaPluginAbi, functionName: "proposalManager" }),
    ),
  );
  return { plugins, managers };
}

function spyZadd() {
  return vi.spyOn<{ zadd: (key: string, score: number, member: string) => Promise<number> }, "zadd">(
    Redis.prototype,
    "zadd",
  );
}

function post(logs: Parameters<typeof blockPayloadWith>[0]) {
  return appClient.index.$post(blockPayloadWith(logs));
}

function blockPayloadWith(logs: { account: { address: Address }; data: Hex; topics: [Hex, ...Hex[]] }[]) {
  return {
    ...withdrawProposal,
    json: {
      ...withdrawProposal.json,
      event: {
        ...withdrawProposal.json.event,
        data: { ...withdrawProposal.json.event.data, block: { ...withdrawProposal.json.event.data.block, logs } },
      },
    },
  };
}
