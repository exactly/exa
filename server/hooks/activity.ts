// cspell:ignore hget hset
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
import { Hono } from "hono";
import { validator } from "hono/validator";
import * as v from "valibot";
import { bytesToHex, formatUnits, hexToBigInt, zeroAddress } from "viem";
import { anvil } from "viem/chains";

import exaChain, { exaPreviewerAbi, exaPreviewerAddress, lifiURL, wethAddress } from "@exactly/common/generated/chain";
import { Address, Hash, Hex } from "@exactly/common/validation";

import { credentials } from "../database/schema";
import t, { f } from "../i18n";
import { activityNetworks, activityUrl, NETWORKS } from "../utils/alchemy";
import publicClient from "../utils/publicClient";
import { cryptoNetwork } from "../utils/sardine";
import validatorHook from "../utils/validatorHook";
import verifySignature from "../utils/verifySignature";

import type * as schema from "../database/schema";
import type createAlchemy from "../utils/alchemy";
import type createOnesignal from "../utils/onesignal";
import type createSardine from "../utils/sardine";
import type createPoke from "../workers/poke/queue";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";

const ETH = v.parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const NATIVE = v.parse(Address, zeroAddress);
const WETH = v.parse(Address, wethAddress);

const debug = createDebug("exa:activity");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default function hook({
  alchemy,
  database,
  onesignal,
  poke,
  redis,
  sardine,
}: {
  alchemy: ReturnType<typeof createAlchemy>;
  database: NodePgDatabase<typeof schema>;
  onesignal: ReturnType<typeof createOnesignal>;
  poke: ReturnType<typeof createPoke>;
  redis: Redis;
  sardine: ReturnType<typeof createSardine>;
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
      if (!entries.has(identity.output.webhookId) && networks.has(identity.output.event.network)) {
        await refresh(true);
        if (valid(identity.output, signature, payload)) return;
      }
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
                  asset: v.string(),
                  rawContract: v.optional(v.object({ address: v.optional(v.undefined()), rawValue: v.optional(Hex) })),
                  log: v.optional(v.undefined()),
                  value: v.optional(v.number()),
                }),
                v.object({
                  category: v.picklist(["token", "erc20", "erc721", "erc1155"]),
                  asset: v.optional(v.string()),
                  rawContract: v.object({ address: Address, rawValue: v.optional(Hex) }),
                  log: v.optional(v.object({ logIndex: Hex })),
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
          columns: { id: true, account: true, publicKey: true, factory: true, salt: true, source: true },
          where: inArray(credentials.account, [...new Set(transfers.map(({ toAddress }) => toAddress))]),
        })
        .then((result) =>
          Object.fromEntries(
            result.map(
              ({ id, account, publicKey, factory, salt, source }) =>
                [
                  v.parse(Address, account),
                  { id, publicKey, factory: v.parse(Address, factory), salt: v.parse(Address, salt), source },
                ] as const,
            ),
          ),
        );
      if (Object.keys(accounts).length === 1) setUser({ id: v.parse(Address, Object.keys(accounts)[0]) });

      const [marketsByAsset, marketPrices] =
        chain.id === exaChain.id
          ? await Promise.all([
              publicClient
                .readContract({ address: exaPreviewerAddress, functionName: "assets", abi: exaPreviewerAbi })
                .then(
                  (p) =>
                    new Map<Address, Address>(p.map((m) => [v.parse(Address, m.asset), v.parse(Address, m.market)])),
                ),
              publicClient
                .readContract({ address: exaPreviewerAddress, functionName: "markets", abi: exaPreviewerAbi })
                .then(
                  (p) =>
                    new Map<Address, number>(
                      p.map((m) => [v.parse(Address, m.asset), Number(formatUnits(m.usdPrice, 18))]),
                    ),
                )
                .catch((error: unknown) => {
                  captureException(error, { level: "error" });
                  return new Map<Address, number>();
                }),
            ])
          : [new Map<Address, Address>(), new Map<Address, number>()];
      const markets = new Set(marketsByAsset.values());
      const pokes = new Map<
        Address,
        {
          assets: Set<Address>;
          factory: Address;
          publicKey: Uint8Array<ArrayBuffer>;
          salt: Address;
          source: null | string;
        }
      >();
      const network = cryptoNetwork(payload.event.network);
      for (const { hash, fromAddress, toAddress: account, rawContract, log, value, asset: assetSymbol } of transfers) {
        if (!accounts[account]) continue;
        if (chain.id === exaChain.id && rawContract?.address && markets.has(rawContract.address)) continue;
        const asset = rawContract?.address ?? ETH;
        const customer = { id: accounts[account].id };
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
        const isMarket = marketsByAsset.has(underlying);
        const token = asset === ETH || isMarket ? undefined : lifiToken(chain.id, underlying, redis);
        const known = token ? token.then((result) => result.known) : Promise.resolve(true);
        known
          .then((isKnown) => {
            if (!isKnown) return;
            if (!markets.has(fromAddress)) {
              (isMarket
                ? Promise.resolve(marketPrices.get(underlying))
                : (token ?? lifiToken(chain.id, NATIVE, redis)).then(({ usdPrice }) => usdPrice)
              )
                .then((usdPrice) => {
                  const amount = value === undefined || usdPrice === undefined ? undefined : value * usdPrice;
                  return sardine.customer({
                    flow: { name: "deposit", type: "transaction" },
                    checkpoints: ["aml_crypto"],
                    customer,
                    transaction: {
                      id: `${hash}:${log?.logIndex ?? asset}`,
                      actionType: "deposit",
                      amount,
                      currencyCode: amount === undefined ? undefined : "USD",
                      itemCategory: assetSymbol,
                      paymentMethod: {
                        type: "crypto",
                        crypto: { assetSymbol, network, address: account, transactionHash: hash },
                      },
                    },
                    counterparty: {
                      id: fromAddress,
                      paymentMethod: { type: "crypto", crypto: { network, address: fromAddress } },
                    },
                  });
                })
                .catch((error: unknown) => captureException(error, { level: "error" }));
            }
            return onesignal.sendPushNotification(notification);
          })
          .catch((error: unknown) => captureException(error, { level: "error" }));

        if (pokes.has(account)) {
          pokes.get(account)?.assets.add(asset);
        } else {
          const { publicKey, factory, salt, source } = accounts[account];
          pokes.set(account, { publicKey, factory, salt, source, assets: new Set([asset]) });
        }
      }
      await Promise.all(
        [...pokes].map(([account, { assets, factory, publicKey, salt, source }]) =>
          poke.enqueue({
            account,
            assets: [...assets],
            chainId: chain.id,
            factory,
            origin: "activity",
            publicKey: bytesToHex(publicKey),
            salt,
            source,
          }),
        ),
      );
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

async function lifiToken(
  chainId: number,
  address: Address,
  redis: Redis,
): Promise<{ known: boolean; usdPrice?: number }> {
  if (chainId === anvil.id) return { known: true };
  const key = `lifi:tokens:${chainId}`;
  const pricesKey = `lifi:prices:${chainId}`;
  try {
    const [[, isMember], [, count], [, cached]] = v.parse(
      v.tuple([
        v.tuple([v.null(), v.number()]),
        v.tuple([v.null(), v.number()]),
        v.tuple([v.null(), v.nullable(v.string())]),
      ]),
      await redis.pipeline().sismember(key, address).scard(key).hget(pricesKey, address).exec(),
    );
    if (isMember) return { known: true, usdPrice: price(cached) };
    if (count > 0) return { known: false };
    const response = await fetch(`${lifiURL ?? "https://li.quest/v1"}/tokens?chains=${chainId}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`lifi tokens ${response.status}`);
    const { tokens } = v.parse(
      v.object({
        tokens: v.record(v.string(), v.array(v.object({ address: v.string(), priceUSD: v.optional(v.string()) }))),
      }),
      await response.json(),
    );
    const list = (tokens[String(chainId)] ?? []).map(({ address: token, priceUSD }) => ({
      address: v.parse(Address, token),
      priceUSD,
    }));
    if (list.length === 0) return { known: true };
    const prices = Object.fromEntries(
      list.flatMap(({ address: token, priceUSD }) => (priceUSD ? [[token, priceUSD] as const] : [])),
    );
    const multi = redis
      .multi()
      .del(key, pricesKey)
      .sadd(key, ...list.map((token) => token.address))
      .expire(key, 3600);
    if (Object.keys(prices).length > 0) multi.hset(pricesKey, prices).expire(pricesKey, 3600);
    await multi.exec();
    const token = list.find((entry) => entry.address === address);
    return token ? { known: true, usdPrice: price(token.priceUSD) } : { known: false };
  } catch (error: unknown) {
    captureException(error, { level: "error" });
    return { known: true };
  }
}

function price(value: null | string | undefined) {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
