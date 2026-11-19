import { captureException, withScope } from "@sentry/node";
import { DelayedError } from "bullmq";
import { v5 } from "uuid";
import { object, parse, string } from "valibot";
import { bytesToBigInt, erc20Abi, hexToBytes, parseUnits, zeroAddress, type LocalAccount } from "viem";

import { dataSuffix } from "@exactly/common/attribution";
import exaChain, {
  activityChains,
  auditorAbi,
  chains,
  exaAccountFactoryAbi,
  exaPluginAbi,
  exaPreviewerAbi,
  lifiURL,
  marketAbi,
  upgradeableModularAccountAbi,
  wethAddress,
} from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import t from "../../i18n";
import { own } from "../../supervise";
import decodePublicKey from "../../utils/decodePublicKey";
import remember from "../../utils/liquidity";
import publicClient from "../../utils/publicClient";
import revertFingerprint from "../../utils/revertFingerprint";
import createWallet from "../../utils/wallet";
import createCredit from "../credit/queue";
import createWorker from "../worker";

import type createOnesignal from "../../utils/onesignal";
import type createSegment from "../../utils/segment";
import type { Redis } from "ioredis";

export default function worker({
  bullmq,
  onesignal,
  poker,
  segment,
}: {
  bullmq: Redis;
  onesignal: ReturnType<typeof createOnesignal>;
  poker: LocalAccount;
  segment: ReturnType<typeof createSegment>;
}) {
  const credit = createCredit(bullmq);
  const prices = new Map<number, bigint>();
  return own(
    createWorker<Job>({
      attempts,
      bullmq,
      failed(job, error) {
        withScope((scope) => {
          if (job) scope.setUser({ id: job.data.account });
          const noBalance = error.message === NO_BALANCE;
          captureException(error, {
            extra: { account: job?.data.account, attempts: job?.attemptsMade, id: job?.id },
            fingerprint: noBalance ? ["{{ default }}", "NoBalance"] : revertFingerprint(error),
            level: noBalance ? "warning" : "error",
            tags: { queue: name, job: job?.name },
          });
        });
      },
      name,
      ready: credit.ready(),
      async process(job, span, token) {
        const chain = activityChains.get(job.data.chainId);
        if (!chain?.smartAccount) throw new Error(`unsupported chain ${job.data.chainId}`);
        const wallet = createWallet(poker, chain);
        const isDeployed = !!(await wallet.getCode({ address: job.data.account }));
        span.setAttribute("exa.new", !isDeployed);
        const exaPreviewer = chains.get(chain.id)?.exaPreviewer;
        const client = chain.id === exaChain.id ? publicClient : wallet;
        const marketsByAsset = new Map<Address, Address>(
          exaPreviewer
            ? await client
                .readContract({ address: exaPreviewer, functionName: "assets", abi: exaPreviewerAbi })
                .then((markets) => markets.map(({ asset, market }) => [parse(Address, asset), parse(Address, market)]))
            : [],
        );
        const balances = exaPreviewer
          ? await Promise.all(
              [...new Set(job.data.assets ?? [ETH, ...marketsByAsset.keys()])]
                .filter((asset) => asset === ETH || marketsByAsset.has(asset))
                .map(async (asset) => ({
                  asset,
                  balance:
                    asset === ETH
                      ? await client.getBalance({ address: job.data.account })
                      : await client.readContract({
                          address: asset,
                          functionName: "balanceOf",
                          args: [job.data.account],
                          abi: erc20Abi,
                        }),
                })),
            )
          : [];
        if (!isDeployed && (job.data.origin !== "allow" || balances.some(({ balance }) => balance > 0n))) {
          const call = {
            address: job.data.factory,
            functionName: "createAccount",
            args: [
              BigInt(job.data.salt),
              [decodePublicKey(new Uint8Array(hexToBytes(job.data.publicKey)), bytesToBigInt)],
            ],
            abi: exaAccountFactoryAbi,
          } as const;
          const [gas, { maxFeePerGas }, gasPrice, balance, price] = await Promise.all([
            wallet.estimateContractGas({ ...call, account: wallet.account.address, dataSuffix }),
            wallet.estimateFeesPerGas(),
            wallet.getGasPrice(),
            wallet.getBalance({ address: wallet.account.address }),
            exaChain.testnet
              ? 0n
              : nativePrice(chain.id).then(
                  (current) => {
                    prices.set(chain.id, current);
                    return current;
                  },
                  (error: unknown) => {
                    captureException(error, { level: "error", tags: { queue: name, job: job.name } });
                    return prices.get(chain.id);
                  },
                ),
          ]);
          const cost = gas * maxFeePerGas;
          const unaffordable = cost > balance;
          if (unaffordable || (price !== undefined && (gas * gasPrice * price) / WAD > MAX_DEPLOY_USD)) {
            span.setAttribute("exa.delayed", true);
            const now = Date.now();
            const data = { ...job.data, delayedAt: job.data.delayedAt ?? now };
            let changed = job.data.delayedAt === undefined;
            if (unaffordable && !data.unaffordable) {
              data.unaffordable = true;
              changed = true;
              captureException(new Error("unaffordable deploy"), {
                extra: { account: data.account, balance: String(balance), cost: String(cost), id: job.id },
                fingerprint: ["{{ default }}", String(chain.id)],
                level: "warning",
                tags: { queue: name, job: job.name },
              });
            }
            if (!data.stuck && now - data.delayedAt >= STUCK_DELAY) {
              data.stuck = true;
              changed = true;
              captureException(new Error("stuck deploy"), {
                extra: {
                  account: data.account,
                  delayedAt: data.delayedAt,
                  gasPrice: String(gasPrice),
                  id: job.id,
                  price: price === undefined ? undefined : String(price),
                },
                fingerprint: ["{{ default }}", String(chain.id)],
                level: "warning",
                tags: { queue: name, job: job.name },
              });
            }
            if (changed) await job.updateData(data);
            await job.moveToDelayed(now + GAS_DELAY, token);
            throw new DelayedError();
          }
          await wallet.exaSend(
            { name: "create account", op: "exa.account", attributes: { account: job.data.account } },
            call,
            { fees: "auto" },
          );
          segment.track({
            event: "AccountFunded",
            userId: job.data.account,
            properties: { source: job.data.source },
          });
        }
        if (!exaPreviewer) return;
        const hasETH = balances.some(({ asset, balance }) => asset === ETH && balance > 0n);
        const notAllowed = `NotAllowed(${job.data.account})`;
        const pending: Address[] = [];
        let poked = false;
        for (const [index, { asset, balance }] of balances.entries()) {
          if (hasETH && asset === WETH) continue;
          if (balance === 0n) {
            pending.push(asset);
            continue;
          }
          let reason: string | undefined;
          const receipt = await wallet.exaSend(
            { name: "poke account", op: "exa.poke", attributes: { account: job.data.account, asset } },
            asset === ETH
              ? { address: job.data.account, abi: accountAbi, functionName: "pokeETH" }
              : {
                  address: job.data.account,
                  abi: accountAbi,
                  functionName: "poke",
                  args: [marketsByAsset.get(asset)!], // eslint-disable-line @typescript-eslint/no-non-null-assertion
                },
            {
              ignore: (current) => {
                reason = current;
                return current === NO_BALANCE || current === MARKET_FROZEN || current === notAllowed;
              },
              ...(chain.id !== exaChain.id && { fees: "auto" as const }),
            },
          );
          if (reason === notAllowed) return;
          if (reason === MARKET_FROZEN) continue;
          if (!receipt) {
            pending.push(asset);
            continue;
          }
          poked = true;
          if (job.data.origin === "activity") {
            await job.updateData({
              ...job.data,
              assets: [
                ...pending,
                ...balances
                  .slice(index + 1)
                  .map(({ asset: remaining }) => remaining)
                  .filter((remaining) => !(hasETH && remaining === WETH)),
              ],
            });
          }
        }
        const users = [job.data.pandaId, job.data.otherPandaId].flatMap((user) => (user ? [user] : []));
        if (poked && users.length > 0) {
          await remember(bullmq, users, job.data.account, chain.id).catch((error: unknown) =>
            captureException(error, { level: "warning", tags: { chainId: chain.id } }),
          );
        }
        if (poked && chain.id === exaChain.id) {
          await credit.enqueue(job.data.account, `poke-${job.id}-${job.attemptsStarted}`);
        }
        if (job.data.origin === "activity" && pending.length > 0) {
          await job.updateData({ ...job.data, assets: pending });
          throw new Error(NO_BALANCE);
        }
        if (job.data.origin === "allow" && poked) {
          await onesignal
            .sendPushNotification({
              userId: job.data.account,
              headings: t("Account assets updated"),
              contents: t("Your funds are ready to use"),
              idempotencyKey: v5(`https://exact.ly/poke/${job.id}/${job.timestamp}`, v5.URL),
              topic: "assets",
            })
            .catch((error: unknown) => captureException(error, { level: "error" }));
        }
      },
    }),
    () => credit.close(),
  );
}

const GAS_DELAY = 10 * 60_000;
const STUCK_DELAY = 12 * 60 * 60_000;
const WAD = 10n ** 18n;
const MAX_DEPLOY_USD = (80n * WAD) / 100n;
const ETH = parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const MARKET_FROZEN = "MarketFrozen()";
const NO_BALANCE = "NoBalance()";
const WETH = parse(Address, wethAddress);
const accountAbi = [...exaPluginAbi, ...upgradeableModularAccountAbi, ...auditorAbi, ...marketAbi];

async function nativePrice(chainId: number) {
  const response = await fetch(`${lifiURL}/token?chain=${chainId}&token=${zeroAddress}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`lifi token ${response.status}`);
  return parseUnits(parse(object({ priceUSD: string() }), await response.json()).priceUSD, 18);
}
