import { vValidator } from "@hono/valibot-validator";
import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import {
  captureException,
  continueTrace,
  getActiveSpan,
  getTraceData,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  setContext,
  setTag,
  setUser,
  startSpan,
  withScope,
} from "@sentry/node";
import createDebug from "debug";
import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import * as v from "valibot";
import { bytesToBigInt, hexToBigInt, withRetry, type LocalAccount } from "viem";
import { anvil } from "viem/chains";

import exaChain, {
  auditorAbi,
  exaAccountFactoryAbi,
  exaPluginAbi,
  exaPreviewerAbi,
  exaPreviewerAddress,
  marketAbi,
  upgradeableModularAccountAbi,
  wethAddress,
} from "@exactly/common/generated/chain";
import { Address, Hash, Hex } from "@exactly/common/validation";

import { credentials } from "../database/schema";
import t, { f } from "../i18n";
import { activityNetworks, activityUrl, NETWORKS } from "../utils/alchemy";
import decodePublicKey from "../utils/decodePublicKey";
import publicClient from "../utils/publicClient";
import revertFingerprint from "../utils/revertFingerprint";
import validatorHook from "../utils/validatorHook";
import verifySignature from "../utils/verifySignature";
import createWallet from "../utils/wallet";

import type * as schema from "../database/schema";
import type createAlchemy from "../utils/alchemy";
import type createOnesignal from "../utils/onesignal";
import type createSegment from "../utils/segment";
import type createCredit from "../workers/credit/queue";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";

const ETH = v.parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const WETH = v.parse(Address, wethAddress);

const debug = createDebug("exa:activity");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default function hook({
  alchemy,
  credit,
  database,
  executor,
  onesignal,
  redis,
  segment,
}: {
  alchemy: ReturnType<typeof createAlchemy>;
  credit: ReturnType<typeof createCredit>;
  database: NodePgDatabase<typeof schema>;
  executor: LocalAccount;
  onesignal: ReturnType<typeof createOnesignal>;
  redis: Redis;
  segment: ReturnType<typeof createSegment>;
}) {
  const networks = activityNetworks();
  let entries = new Map<string, { network: string; signingKey: string }>();
  let refreshed = 0;
  let refreshing: Promise<void> | undefined;
  const app = new Hono().post(
    "/",
    validator("header", async ({ "x-alchemy-signature": signature }, c) => {
      const payload = await c.req.arrayBuffer();
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return c.json({ code: "unauthorized" }, 401);
      }
      const identity = v.safeParse(Identity, parsed);
      if (!identity.success) return c.json({ code: "unauthorized" }, 401);
      if (valid(identity.output, signature, payload)) return;
      await refresh(true);
      if (valid(identity.output, signature, payload)) return;
      return c.json({ code: "unauthorized" }, 401);
    }),
    vValidator(
      "json",
      v.object({
        type: v.literal("ADDRESS_ACTIVITY"),
        webhookId: v.string(),
        event: v.object({
          network: v.pipe(
            v.string(),
            v.check((input) => NETWORKS.has(input), "unsupported network"),
          ),
          activity: v.array(
            v.intersect([
              v.object({ hash: Hash, fromAddress: Address, toAddress: Address }),
              v.variant("category", [
                v.object({
                  category: v.picklist(["external", "internal"]),
                  asset: v.literal("ETH"),
                  rawContract: v.optional(v.object({ address: v.optional(v.undefined()), rawValue: v.optional(Hex) })),
                  value: v.optional(v.number()),
                }),
                v.object({
                  category: v.picklist(["token", "erc20", "erc721", "erc1155"]),
                  asset: v.optional(v.string()),
                  rawContract: v.object({ address: Address, rawValue: v.optional(Hex) }),
                  value: v.optional(v.number()),
                }),
              ]),
            ]),
          ),
        }),
      }),
      validatorHook({ code: "bad alchemy", status: 200, debug }),
    ),
    async (c) => {
      const payload = c.req.valid("json");
      const chain = NETWORKS.get(payload.event.network);
      if (!chain) throw new Error("unsupported activity network");
      setContext("alchemy", payload);
      setTag("alchemy.network", payload.event.network);
      getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "alchemy.activity");
      const transfers = payload.event.activity.filter(
        ({ category, rawContract, value }) =>
          category !== "erc721" &&
          category !== "erc1155" &&
          (rawContract?.rawValue && rawContract.rawValue !== "0x" ? hexToBigInt(rawContract.rawValue) > 0n : !!value),
      );
      const accounts = await database.query.credentials
        .findMany({
          columns: { account: true, publicKey: true, factory: true, source: true },
          where: inArray(credentials.account, [...new Set(transfers.map(({ toAddress }) => toAddress))]),
        })
        .then((result) =>
          Object.fromEntries(
            result.map(
              ({ account, publicKey, factory, source }) =>
                [v.parse(Address, account), { publicKey, factory: v.parse(Address, factory), source }] as const,
            ),
          ),
        );
      if (Object.keys(accounts).length === 1) setUser({ id: v.parse(Address, Object.keys(accounts)[0]) });

      const marketsByAsset =
        chain.id === exaChain.id
          ? await publicClient
              .readContract({ address: exaPreviewerAddress, functionName: "assets", abi: exaPreviewerAbi })
              .then(
                (p) => new Map<Address, Address>(p.map((m) => [v.parse(Address, m.asset), v.parse(Address, m.market)])),
              )
          : new Map<Address, Address>();
      const markets = new Set(marketsByAsset.values());
      const pokes = new Map<
        Address,
        { assets: Set<Address>; factory: Address; publicKey: Uint8Array<ArrayBuffer>; source: null | string }
      >();
      for (const { toAddress: account, rawContract, value, asset: assetSymbol } of transfers) {
        if (!accounts[account]) continue;
        if (chain.id === exaChain.id && rawContract?.address && markets.has(rawContract.address)) continue;
        const asset = rawContract?.address ?? ETH;
        const underlying = asset === ETH ? WETH : asset;
        const notification = {
          userId: account,
          headings: t("Funds received"),
          contents: t(
            chain.id === exaChain.id && marketsByAsset.has(underlying)
              ? "{{amount}} received and instantly started earning yield"
              : "{{amount}} received",
            {
              amount: value
                ? Object.fromEntries(
                    Object.entries(f(value)).map(([language, amount]) => [
                      language,
                      assetSymbol ? `${amount} ${assetSymbol}` : amount,
                    ]),
                  )
                : assetSymbol,
            },
          ),
        };
        const known = marketsByAsset.has(underlying)
          ? Promise.resolve(true)
          : isKnownToken(chain.id, underlying, redis);
        known
          .then((isKnown) => (isKnown ? onesignal.sendPushNotification(notification) : undefined))
          .catch((error: unknown) => captureException(error, { level: "error" }));

        if (pokes.has(account)) {
          pokes.get(account)?.assets.add(asset);
        } else {
          const { publicKey, factory, source } = accounts[account];
          pokes.set(account, { publicKey, factory, source, assets: new Set([asset]) });
        }
      }
      const { "sentry-trace": sentryTrace, baggage } = getTraceData();
      const wallet = createWallet(executor, chain);
      Promise.allSettled(
        [...pokes].map(([account, { publicKey, factory, source, assets }]) =>
          continueTrace({ sentryTrace, baggage }, () =>
            withScope((scope) =>
              startSpan(
                { name: "account activity", op: "exa.activity", attributes: { account }, forceTransaction: true },
                async (span) => {
                  scope.setUser({ id: account });
                  const isDeployed = !!(await wallet.getCode({ address: account }));
                  scope.setTag("exa.new", !isDeployed);
                  if (!isDeployed) {
                    try {
                      await wallet.exaSend(
                        { name: "create account", op: "exa.account", attributes: { account } },
                        {
                          address: factory,
                          functionName: "createAccount",
                          args: [0n, [decodePublicKey(publicKey, bytesToBigInt)]],
                          abi: exaAccountFactoryAbi,
                        },
                        chain.id === exaChain.id ? undefined : { fees: "auto" },
                      );
                      segment.track({ event: "AccountFunded", userId: account, properties: { source } });
                    } catch (error: unknown) {
                      span.setStatus({ code: SPAN_STATUS_ERROR, message: "account_failed" });
                      throw error;
                    }
                  }
                  if (chain.id !== exaChain.id) {
                    span.setStatus({ code: SPAN_STATUS_OK });
                    return;
                  }
                  if (assets.has(ETH)) assets.delete(WETH);
                  const results = await Promise.allSettled(
                    [...assets]
                      .filter((asset) => marketsByAsset.has(asset) || asset === ETH)
                      .map(async (asset) =>
                        withRetry(
                          () =>
                            wallet
                              .exaSend(
                                { name: "poke account", op: "exa.poke", attributes: { account, asset } },
                                {
                                  address: account,
                                  abi: [...exaPluginAbi, ...upgradeableModularAccountAbi, ...auditorAbi, ...marketAbi],
                                  ...(asset === ETH
                                    ? { functionName: "pokeETH" }
                                    : {
                                        functionName: "poke",
                                        args: [marketsByAsset.get(asset)!], // eslint-disable-line @typescript-eslint/no-non-null-assertion
                                      }),
                                },
                                { ignore: ["NoBalance()"] },
                              )
                              .then((receipt) => {
                                if (receipt) return receipt;
                                throw new Error("NoBalance()");
                              }),
                          {
                            delay: 2000,
                            retryCount: 5,
                            shouldRetry: ({ error }) => {
                              if (error instanceof Error && error.message === "NoBalance()") return true;
                              withScope((captureScope) => {
                                captureScope.setUser({ id: account });
                                captureException(error, { level: "error", fingerprint: revertFingerprint(error) });
                              });
                              return true;
                            },
                          },
                        ),
                      ),
                  );
                  for (const result of results) {
                    if (result.status === "fulfilled") {
                      await credit.enqueue(account);
                      continue;
                    }
                    if (result.reason instanceof Error && result.reason.message === "NoBalance()") {
                      withScope((captureScope) => {
                        captureScope.setUser({ id: account });
                        captureScope.addEventProcessor((event) => {
                          if (event.exception?.values?.[0]) event.exception.values[0].type = "NoBalance";
                          return event;
                        });
                        captureException(result.reason, {
                          level: "warning",
                          fingerprint: ["{{ default }}", "NoBalance"],
                        });
                      });
                      continue;
                    }
                    span.setStatus({ code: SPAN_STATUS_ERROR, message: "poke_failed" });
                    throw result.reason;
                  }
                  span.setStatus({ code: SPAN_STATUS_OK });
                },
              ),
            ),
          ).catch((error: unknown) => {
            withScope((scope) => {
              scope.setUser({ id: account });
              captureException(error, { level: "error", fingerprint: revertFingerprint(error) });
            });
            throw error;
          }),
        ),
      )
        .then((results) => {
          getActiveSpan()?.setStatus(
            results.every((result) => result.status === "fulfilled")
              ? { code: SPAN_STATUS_OK }
              : { code: SPAN_STATUS_ERROR, message: "activity_failed" },
          );
        })
        .catch((error: unknown) => captureException(error));
      return c.json({});
    },
  );
  return { app, ready: refresh(false) };

  function valid(identity: v.InferOutput<typeof Identity>, signature: string | undefined, payload: ArrayBuffer) {
    const entry = entries.get(identity.webhookId);
    return (
      entry?.network === identity.event.network && verifySignature({ signature, signingKey: entry.signingKey, payload })
    );
  }

  async function refresh(cached: boolean) {
    if (cached && Date.now() - refreshed < 1000) return;
    refreshing ??= alchemy
      .getWebhooks()
      .then((webhooks) => {
        entries = new Map(
          webhooks
            .filter(
              (current) =>
                current.is_active &&
                current.webhook_type === "ADDRESS_ACTIVITY" &&
                current.webhook_url === activityUrl &&
                networks.has(current.network),
            )
            .map((current) => [current.id, { network: current.network, signingKey: current.signing_key }]),
        );
        if (cached) refreshed = Date.now();
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  }
}

const Identity = v.object({ webhookId: v.string(), event: v.object({ network: v.string() }) });

async function isKnownToken(chainId: number, address: Address, redis: Redis) {
  if (chainId === anvil.id) return true;
  const key = `lifi:tokens:${chainId}`;
  try {
    const [[, isMember], [, count]] = v.parse(
      v.tuple([v.tuple([v.null(), v.number()]), v.tuple([v.null(), v.number()])]),
      await redis.pipeline().sismember(key, address).scard(key).exec(),
    );
    if (isMember) return true;
    if (count > 0) return false;
    const response = await fetch(`https://li.quest/v1/tokens?chains=${chainId}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`lifi tokens ${response.status}`);
    const { tokens } = v.parse(
      v.object({ tokens: v.record(v.string(), v.array(v.object({ address: v.string() }))) }),
      await response.json(),
    );
    const addresses = (tokens[String(chainId)] ?? []).map((token) => v.parse(Address, token.address));
    if (addresses.length === 0) return true;
    await redis
      .multi()
      .del(key)
      .sadd(key, ...addresses)
      .expire(key, 3600)
      .exec();
    return addresses.includes(address);
  } catch (error: unknown) {
    captureException(error, { level: "error" });
    return true;
  }
}
