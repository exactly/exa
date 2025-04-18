import chain, {
  exaAccountFactoryAbi,
  exaPluginAbi,
  exaPreviewerAbi,
  exaPreviewerAddress,
  upgradeableModularAccountAbi,
  wethAddress,
} from "@exactly/common/generated/chain";
import { Address, Hash } from "@exactly/common/validation";
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
import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import * as v from "valibot";
import { bytesToBigInt } from "viem";
import { optimism } from "viem/chains";

import database, { credentials } from "../database";
import { auditorAbi, marketAbi } from "../generated/contracts";
import { headerValidator, jsonValidator } from "../utils/alchemy";
import decodePublicKey from "../utils/decodePublicKey";
import keeper from "../utils/keeper";
import { sendPushNotification } from "../utils/onesignal";
import publicClient from "../utils/publicClient";

if (!process.env.ALCHEMY_ACTIVITY_KEY) throw new Error("missing alchemy activity key");
const signingKey = process.env.ALCHEMY_ACTIVITY_KEY;

const ETH = v.parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");

const debug = createDebug("exa:activity");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default new Hono().post(
  "/",
  headerValidator(new Set([signingKey])),
  jsonValidator(
    v.object({
      type: v.literal("ADDRESS_ACTIVITY"),
      event: v.object({
        network: v.literal(chain.id === optimism.id ? "OPT_MAINNET" : "OPT_SEPOLIA"),
        activity: v.array(
          v.intersect([
            v.object({ hash: Hash, fromAddress: Address, toAddress: Address }),
            v.variant("category", [
              v.object({
                category: v.picklist(["external", "internal"]),
                asset: v.literal("ETH"),
                rawContract: v.object({ address: v.optional(v.undefined()) }),
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
    debug,
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
    const pokes = new Map<Address, { publicKey: Uint8Array; factory: Address; assets: Set<Address> }>();
    for (const { toAddress: account, rawContract, value, asset: assetSymbol } of transfers) {
      if (!accounts[account]) continue;
      const asset = rawContract.address ?? ETH;
      const underlying = asset === ETH ? v.parse(Address, wethAddress) : asset;
      if (!marketsByAsset.has(underlying)) continue;

      sendPushNotification({
        userId: account,
        headings: { en: "Funds added" },
        contents: { en: `${value ? `${value} ` : ""}${assetSymbol} received` },
      }).catch((error: unknown) => captureException(error));
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (pokes.has(account)) pokes.get(account)!.assets.add(asset);
      else {
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
                  } catch (error: unknown) {
                    span.setStatus({ code: SPAN_STATUS_ERROR, message: "account_failed" });
                    throw error;
                  }
                }
                const results = await Promise.allSettled(
                  [...assets].map(async (asset) =>
                    keeper.exaSend(
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
                    ),
                  ),
                );
                for (const result of results) {
                  if (result.status === "fulfilled") continue;
                  span.setStatus({ code: SPAN_STATUS_ERROR, message: "poke_failed" });
                  throw result.reason;
                }
                span.setStatus({ code: SPAN_STATUS_OK, message: "ok" });
              },
            ),
          ),
        ),
      ),
    )
      .then((results) => {
        let status: SpanStatus = { code: SPAN_STATUS_OK, message: "ok" };
        for (const result of results) {
          if (result.status === "fulfilled") continue;
          status = { code: SPAN_STATUS_ERROR, message: "activity_failed" };
          captureException(result.reason, { level: "error" });
        }
        getActiveSpan()?.setStatus(status);
      })
      .catch((error: unknown) => captureException(error));
    return c.json({});
  },
);
