import { captureException, withScope } from "@sentry/node";
import { parse } from "valibot";
import { bytesToBigInt, encodeDeployData, erc20Abi, hexToBytes, zeroAddress, type LocalAccount } from "viem";

import exaChain, {
  auditorAbi,
  auditors,
  exaAccountFactoryAbi,
  exaPluginAbi,
  exaPreviewerAbi,
  exaPreviewerCode,
  marketAbi,
  upgradeableModularAccountAbi,
  wethAddress,
} from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import t from "../../i18n";
import { own } from "../../supervise";
import { NETWORKS } from "../../utils/alchemy";
import decodePublicKey from "../../utils/decodePublicKey";
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
      async process(job, span) {
        const chain = [...NETWORKS.values()].find(({ id }) => id === job.data.chainId);
        if (!chain) throw new Error(`unsupported chain ${job.data.chainId}`);
        const wallet = createWallet(poker, chain);
        const isDeployed = !!(await wallet.getCode({ address: job.data.account }));
        span.setAttribute("exa.new", !isDeployed);
        if (!isDeployed) {
          await wallet.exaSend(
            { name: "create account", op: "exa.account", attributes: { account: job.data.account } },
            {
              address: job.data.factory,
              functionName: "createAccount",
              args: [
                BigInt(job.data.salt),
                [decodePublicKey(new Uint8Array(hexToBytes(job.data.publicKey)), bytesToBigInt)],
              ],
              abi: exaAccountFactoryAbi,
            },
            chain.id === exaChain.id ? {} : { fees: "auto" },
          );
          segment.track({
            event: "AccountFunded",
            userId: job.data.account,
            properties: { source: job.data.source },
          });
        }
        const auditor = auditors.get(chain.id);
        if (!auditor) return;
        const client = chain.id === exaChain.id ? publicClient : wallet;
        const marketsByAsset = await client
          .readContract({
            code: encodeDeployData({
              abi: exaPreviewerAbi,
              bytecode: exaPreviewerCode,
              args: [auditor, zeroAddress],
            }),
            functionName: "assets",
            abi: exaPreviewerAbi,
          })
          .then(
            (markets) =>
              new Map<Address, Address>(
                markets.map(({ asset, market }) => [parse(Address, asset), parse(Address, market)]),
              ),
          );
        const balances = await Promise.all(
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
        );
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
            })
            .catch((error: unknown) => captureException(error, { level: "error" }));
        }
      },
    }),
    () => credit.close(),
  );
}

const ETH = parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const MARKET_FROZEN = "MarketFrozen()";
const NO_BALANCE = "NoBalance()";
const WETH = parse(Address, wethAddress);
const accountAbi = [...exaPluginAbi, ...upgradeableModularAccountAbi, ...auditorAbi, ...marketAbi];
