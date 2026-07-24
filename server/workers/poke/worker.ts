import { createConfiguration, DefaultApi } from "@onesignal/node-onesignal";
import { Analytics } from "@segment/analytics-node";
import { captureException, withScope } from "@sentry/node";
import { parse } from "valibot";
import { bytesToBigInt, erc20Abi, hexToBytes } from "viem";

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
import stack from "@exactly/common/stack";
import { Address } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import t from "../../i18n";
import { NETWORKS } from "../../utils/alchemy";
import decodePublicKey from "../../utils/decodePublicKey";
import { sendPushNotification } from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import revertFingerprint from "../../utils/revertFingerprint";
import { getWallet } from "../../utils/wallet";
import { close as closeCredit, enqueue as enqueueCredit, start as startCredit } from "../credit/queue";
import createWorker, { connect } from "../worker";

export default function worker({
  onesignalKey,
  redisUrl,
  segmentKey,
}: {
  onesignalKey: string;
  redisUrl: string;
  segmentKey: string;
}) {
  const analytics = new Analytics({ writeKey: segmentKey });
  const bullmq = connect(redisUrl);
  startCredit(bullmq);
  analytics.on("error", (error) => captureException(error, { level: "error" }));
  const onesignal = new DefaultApi(createConfiguration({ restApiKey: onesignalKey }));
  return createWorker<Job>({
    attempts,
    bullmq,
    close: () => closeCredit().finally(() => analytics.closeAndFlush()),
    failed(job, error) {
      withScope((scope) => {
        if (job) scope.setUser({ id: job.data.account });
        const noBalance = error.message === "NoBalance()";
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
      const wallet = await getWallet(`${stack}-poker`, chain);
      const isDeployed = !!(await wallet.getCode({ address: job.data.account }));
      span.setAttribute("exa.new", !isDeployed);
      if (!isDeployed) {
        await wallet.exaSend(
          { name: "create account", op: "exa.account", attributes: { account: job.data.account } },
          {
            address: job.data.factory,
            functionName: "createAccount",
            args: [0n, [decodePublicKey(new Uint8Array(hexToBytes(job.data.publicKey)), bytesToBigInt)]],
            abi: exaAccountFactoryAbi,
          },
          chain.id === exaChain.id ? {} : { fees: "auto" },
        );
        try {
          analytics.track({
            event: "AccountFunded",
            userId: job.data.account,
            properties: { source: job.data.source },
          });
        } catch (error: unknown) {
          captureException(error, { level: "error" });
        }
      }
      if (chain.id === exaChain.id) {
        const marketsByAsset = await publicClient
          .readContract({ address: exaPreviewerAddress, functionName: "assets", abi: exaPreviewerAbi })
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
                  ? await publicClient.getBalance({ address: job.data.account })
                  : await publicClient.readContract({
                      address: asset,
                      functionName: "balanceOf",
                      args: [job.data.account],
                      abi: erc20Abi,
                    }),
            })),
        );
        const hasETH = balances.some(({ asset, balance }) => asset === ETH && balance > 0n);
        const pending: Address[] = [];
        let poked = false;
        for (const [index, { asset, balance }] of balances.entries()) {
          if (hasETH && asset === WETH) continue;
          if (balance === 0n) {
            pending.push(asset);
            continue;
          }
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
            { ignore: ["NoBalance()"] },
          );
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
        if (job.data.origin === "activity" && pending.length > 0) {
          await job.updateData({ ...job.data, assets: pending });
          throw new Error("NoBalance()");
        }
        if (job.data.origin === "allow" && poked) {
          await sendPushNotification(
            {
              userId: job.data.account,
              headings: t("Account assets updated"),
              contents: t("Your funds are ready to use"),
            },
            onesignal,
          ).catch((error: unknown) => captureException(error, { level: "error" }));
        }
        if (job.data.origin === "activity") {
          await enqueueCredit(job.data.account);
        }
      }
    },
  });
}

const ETH = parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const WETH = parse(Address, wethAddress);
const accountAbi = [...exaPluginAbi, ...upgradeableModularAccountAbi, ...auditorAbi, ...marketAbi];
