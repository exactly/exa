import { vValidator } from "@hono/valibot-validator";
import { SPAN_STATUS_ERROR, SPAN_STATUS_OK, type SpanStatus } from "@sentry/core";
import {
  captureException,
  continueTrace,
  getActiveSpan,
  getTraceData,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  setContext,
  startSpan,
  withScope,
} from "@sentry/node";
import createDebug from "debug";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import * as v from "valibot";
import { bytesToBigInt, withRetry } from "viem";

import {
  auditorAbi,
  exaAccountFactoryAbi,
  exaPluginAbi,
  exaPreviewerAbi,
  exaPreviewerAddress,
  marketAbi,
  upgradeableModularAccountAbi,
  wethAddress,
} from "@exactly/common/generated/chain";
import { Address, Hash } from "@exactly/common/validation";

import database, { cards, credentials } from "../database";
import { createWebhook, findWebhook, headerValidator, network } from "../utils/alchemy";
import appOrigin from "../utils/appOrigin";
import decodePublicKey from "../utils/decodePublicKey";
import keeper from "../utils/keeper";
import { sendPushNotification } from "../utils/onesignal";
import { autoCredit } from "../utils/panda";
import publicClient from "../utils/publicClient";
import revertFingerprint from "../utils/revertFingerprint";
import { track } from "../utils/segment";
import validatorHook from "../utils/validatorHook";

const ETH = v.parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const WETH = v.parse(Address, wethAddress);

const debug = createDebug("exa:activity");
Object.assign(debug, { inspectOpts: { depth: undefined } });

if (!process.env.ALCHEMY_ACTIVITY_ID) debug("missing alchemy activity id");
export let webhookId = process.env.ALCHEMY_ACTIVITY_ID;

if (!process.env.ALCHEMY_ACTIVITY_KEY) debug("missing alchemy activity key");
const signingKeys = new Set(process.env.ALCHEMY_ACTIVITY_KEY && [process.env.ALCHEMY_ACTIVITY_KEY]);

export default new Hono().post(
  "/",
  headerValidator(signingKeys),
  vValidator(
    "json",
    v.object({
      type: v.literal("ADDRESS_ACTIVITY"),
      event: v.object({
        network: v.literal(network),
        activity: v.array(
          v.intersect([
            v.object({ hash: Hash, fromAddress: Address, toAddress: Address }),
            v.variant("category", [
              v.object({
                category: v.picklist(["external", "internal"]),
                asset: v.literal("ETH"),
                rawContract: v.optional(v.object({ address: v.optional(v.undefined()) })),
                value: v.number(),
              }),
              v.object({
                category: v.picklist(["token", "erc20", "erc721", "erc1155"]),
                asset: v.optional(v.string()),
                rawContract: v.object({ address: Address }),
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
    setContext("alchemy", await c.req.json());
    getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "alchemy.activity");
    const transfers = c.req
      .valid("json")
      .event.activity.filter(({ category, value }) => category !== "erc721" && category !== "erc1155" && value);
    const accounts = await database.query.credentials
      .findMany({
        columns: { account: true, publicKey: true, factory: true },
        where: inArray(credentials.account, [...new Set(transfers.map(({ toAddress }) => toAddress))]),
      })
      .then((result) =>
        Object.fromEntries(
          result.map(
            ({ account, publicKey, factory }) =>
              [v.parse(Address, account), { publicKey, factory: v.parse(Address, factory) }] as const,
          ),
        ),
      );

    const marketsByAsset = await publicClient
      .readContract({ address: exaPreviewerAddress, functionName: "assets", abi: exaPreviewerAbi })
      .then((p) => new Map<Address, Address>(p.map((m) => [v.parse(Address, m.asset), v.parse(Address, m.market)])));
    const markets = new Set(marketsByAsset.values());
    const pokes = new Map<Address, { assets: Set<Address>; factory: Address; publicKey: Uint8Array<ArrayBuffer> }>();
    for (const { toAddress: account, rawContract, value, asset: assetSymbol } of transfers) {
      if (!accounts[account]) continue;
      if (rawContract?.address && markets.has(rawContract.address)) continue;
      const asset = rawContract?.address ?? ETH;
      const underlying = asset === ETH ? WETH : asset;
      sendPushNotification({
        userId: account,
        headings: { en: "Funds received" },
        contents: {
          en: `${value ? `${value} ` : ""}${assetSymbol} received${marketsByAsset.has(underlying) ? " and instantly started earning yield" : ""}`,
        },
      }).catch((error: unknown) => captureException(error));

      if (pokes.has(account)) {
        pokes.get(account)?.assets.add(asset);
      } else {
        const { publicKey, factory } = accounts[account];
        pokes.set(account, { publicKey, factory, assets: new Set([asset]) });
      }
    }
    const { "sentry-trace": sentryTrace, baggage } = getTraceData();
    Promise.allSettled(
      [...pokes.entries()].map(([account, { publicKey, factory, assets }]) =>
        continueTrace({ sentryTrace, baggage }, () =>
          withScope((scope) =>
            startSpan(
              { name: "account activity", op: "exa.activity", attributes: { account }, forceTransaction: true },
              async (span) => {
                scope.setUser({ id: account });
                scope.setTag("exa.account", account);
                const isDeployed = !!(await publicClient.getCode({ address: account }));
                scope.setTag("exa.new", !isDeployed);
                if (!isDeployed) {
                  try {
                    await keeper.exaSend(
                      { name: "create account", op: "exa.account", attributes: { account } },
                      {
                        address: factory,
                        functionName: "createAccount",
                        args: [0n, [decodePublicKey(publicKey, bytesToBigInt)]],
                        abi: exaAccountFactoryAbi,
                      },
                    );
                    track({ event: "AccountFunded", userId: account });
                  } catch (error: unknown) {
                    span.setStatus({ code: SPAN_STATUS_ERROR, message: "account_failed" });
                    throw error;
                  }
                }
                if (assets.has(ETH)) assets.delete(WETH);
                const results = await Promise.allSettled(
                  [...assets]
                    .filter((asset) => marketsByAsset.has(asset) || asset === ETH)
                    .map(async (asset) =>
                      withRetry(
                        () =>
                          keeper
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
                            captureException(error, { level: "error", fingerprint: revertFingerprint(error) });
                            return true;
                          },
                        },
                      ),
                    ),
                );
                for (const result of results) {
                  if (result.status === "fulfilled") continue;
                  if (result.reason instanceof Error && result.reason.message === "NoBalance()") {
                    captureException(result.reason, {
                      level: "warning",
                      fingerprint: ["{{ default }}", result.reason.message],
                    });
                    continue;
                  }
                  span.setStatus({ code: SPAN_STATUS_ERROR, message: "poke_failed" });
                  throw result.reason;
                }
                autoCredit(account)
                  .then(async (auto) => {
                    span.setAttribute("exa.autoCredit", auto);
                    if (!auto) return;
                    const credential = await database.query.credentials.findFirst({
                      where: eq(credentials.account, account),
                      columns: {},
                      with: {
                        cards: {
                          columns: { id: true, mode: true },
                          where: inArray(cards.status, ["ACTIVE", "FROZEN"]),
                        },
                      },
                    });
                    if (!credential || credential.cards.length === 0) return;
                    const card = credential.cards[0];
                    span.setAttribute("exa.card", card?.id);
                    if (card?.mode !== 0) return;
                    await database.update(cards).set({ mode: 1 }).where(eq(cards.id, card.id));
                    span.setAttribute("exa.mode", 1);
                    sendPushNotification({
                      userId: account,
                      headings: { en: "Card mode changed" },
                      contents: { en: "Credit mode activated" },
                    }).catch((error: unknown) => captureException(error));
                  })
                  .catch((error: unknown) => captureException(error));
                span.setStatus({ code: SPAN_STATUS_OK });
              },
            ),
          ),
        ),
      ),
    )
      .then((results) => {
        let status: SpanStatus = { code: SPAN_STATUS_OK };
        for (const result of results) {
          if (result.status === "fulfilled") continue;
          status = { code: SPAN_STATUS_ERROR, message: "activity_failed" };
          captureException(result.reason, { level: "error", fingerprint: revertFingerprint(result.reason) });
        }
        getActiveSpan()?.setStatus(status);
      })
      .catch((error: unknown) => captureException(error));
    return c.json({});
  },
);

const url = `${appOrigin}/hooks/activity`;
findWebhook(({ webhook_type, webhook_url }) => webhook_type === "ADDRESS_ACTIVITY" && webhook_url === url)
  .then(async (currentHook) => {
    if (currentHook) {
      webhookId = currentHook.id;
      return signingKeys.add(currentHook.signing_key);
    }
    const newHook = await createWebhook({ webhook_type: "ADDRESS_ACTIVITY", webhook_url: url, addresses: [] });
    webhookId = newHook.id;
    signingKeys.add(newHook.signing_key);
  })
  .catch((error: unknown) => captureException(error));
