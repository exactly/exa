import { vValidator } from "@hono/valibot-validator";
import {
  captureException,
  getActiveSpan,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  setContext,
  setTag,
  setUser,
} from "@sentry/node";
import createDebug from "debug";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { Redis } from "ioredis";
import * as v from "valibot";
import { bytesToHex, hexToBigInt } from "viem";
import { anvil } from "viem/chains";

import exaChain, { exaPreviewerAbi, exaPreviewerAddress, wethAddress } from "@exactly/common/generated/chain";
import { Address, Hash, Hex } from "@exactly/common/validation";

import { credentials } from "../database/schema";
import t, { f } from "../i18n";
import { setWebhookId } from "../utils/activityWebhook";
import createAlchemy, { headerValidator, NETWORKS } from "../utils/alchemy";
import appOrigin from "../utils/appOrigin";
import createOnesignal from "../utils/onesignal";
import publicClient from "../utils/publicClient";
import validatorHook from "../utils/validatorHook";
import createPoke from "../workers/poke/queue";

const ETH = v.parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const WETH = v.parse(Address, wethAddress);

const debug = createDebug("exa:activity");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default function hook({
  activityKey,
  alchemyKey,
  onesignalKey,
  postgresUrl,
  redisUrl,
}: {
  activityKey?: string;
  alchemyKey: string;
  onesignalKey: string;
  postgresUrl: string;
  redisUrl: string;
}) {
  const database = drizzle(postgresUrl, { schema: { credentials } });
  const onesignal = createOnesignal(onesignalKey);
  const redis = new Redis(redisUrl);
  const bullmq = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const poke = createPoke(bullmq);
  if (!activityKey) debug("missing alchemy activity key");
  const signingKeys = new Set(activityKey && [activityKey]);
  const app = new Hono().post(
    "/",
    headerValidator(signingKeys),
    vValidator(
      "json",
      v.object({
        type: v.literal("ADDRESS_ACTIVITY"),
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
      await Promise.all(
        [...pokes].map(([account, { assets, factory, publicKey, source }]) =>
          poke.enqueue({
            account,
            assets: [...assets],
            chainId: chain.id,
            factory,
            origin: "activity",
            publicKey: bytesToHex(publicKey),
            source,
          }),
        ),
      );
      return c.json({});
    },
  );
  const alchemy = createAlchemy(alchemyKey);
  let closing: Promise<unknown> | undefined;
  return {
    app,
    close: () =>
      (closing ??= Promise.all([database.$client.end(), redis.quit(), poke.close().finally(() => bullmq.quit())])),
    ready: alchemy
      .findWebhook(({ webhook_type, webhook_url }) => webhook_type === "ADDRESS_ACTIVITY" && webhook_url === url)
      .then(async (currentHook) => {
        if (currentHook) {
          setWebhookId(currentHook.id);
          debug("alchemy webhook initialized with existing hook: %s", currentHook.id);
          return signingKeys.add(currentHook.signing_key);
        }
        const newHook = await alchemy.createWebhook({
          webhook_type: "ADDRESS_ACTIVITY",
          webhook_url: url,
          addresses: [],
        });
        setWebhookId(newHook.id);
        debug("alchemy webhook initialized with new hook: %s", newHook.id);
        signingKeys.add(newHook.signing_key);
      }),
  };
}

const url = `${appOrigin}/hooks/activity`;

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
