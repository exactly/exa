import { captureException } from "@sentry/node";
import { parse } from "valibot";
import {
  createWalletClient,
  erc20Abi,
  http,
  withRetry,
  type HttpTransport,
  type PrivateKeyAccount,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain, {
  auditorAbi,
  exaPluginAbi,
  exaPreviewerAbi,
  exaPreviewerAddress,
  marketAbi,
  upgradeableModularAccountAbi,
  wethAddress,
} from "@exactly/common/generated/chain";
import { Address, Hash } from "@exactly/common/validation";

import baseExtender from "./baseExtender";
import nonceManager from "./nonceManager";
import { sendPushNotification } from "./onesignal";
import publicClient, { captureRequests, Requests } from "./publicClient";

if (!chain.rpcUrls.alchemy.http[0]) throw new Error("missing alchemy rpc url");

export default createWalletClient({
  chain,
  transport: http(`${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`, {
    batch: true,
    async onFetchRequest(request) {
      captureRequests(parse(Requests, await request.json()));
    },
  }),
  account: privateKeyToAccount(
    parse(Hash, process.env.KEEPER_PRIVATE_KEY, {
      message: "invalid keeper private key",
    }),
    { nonceManager },
  ),
}).extend(extender);

const ETH = parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const WETH = parse(Address, wethAddress);

export function extender(keeper: WalletClient<HttpTransport, typeof chain, PrivateKeyAccount>) {
  const base = baseExtender(keeper);

  return {
    ...base,
    poke: async (
      accountAddress: Address,
      options?: { ignore?: string[]; notification?: { contents: { en: string }; headings: { en: string } } },
    ) => {
      const combinedAccountAbi = [...exaPluginAbi, ...upgradeableModularAccountAbi, ...auditorAbi, ...marketAbi];
      const marketsByAsset = await withRetry(
        () => publicClient.readContract({ address: exaPreviewerAddress, functionName: "assets", abi: exaPreviewerAbi }),
        {
          delay: 2000,
          retryCount: 5,
          shouldRetry: ({ error }) => {
            captureException(error, { level: "error" });
            return true;
          },
        },
      ).then((p) => new Map<Address, Address>(p.map((m) => [parse(Address, m.asset), parse(Address, m.market)])));

      const assetsToPoke: { asset: Address; market: Address | null }[] = [];

      const [ethBalance, assetBalances] = await Promise.all([
        withRetry(() => publicClient.getBalance({ address: accountAddress }), {
          delay: 2000,
          retryCount: 5,
          shouldRetry: ({ error }) => {
            captureException(error, { level: "error" });
            return true;
          },
        }),
        Promise.all(
          [...marketsByAsset.entries()].map(async ([asset, market]) => {
            const maxAttempts = 3;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                const balance = await publicClient.readContract({
                  address: asset,
                  functionName: "balanceOf",
                  args: [accountAddress],
                  abi: erc20Abi,
                });
                return { asset, market, balance };
              } catch (error) {
                captureException(error, { level: "error" });
                if (attempt === maxAttempts) {
                  return { asset, market, balance: 0n };
                }
                await new Promise((resolve) => globalThis.setTimeout(resolve, 1000 * attempt));
              }
            }
            return { asset, market, balance: 0n };
          }),
        ),
      ]);

      const hasETH = ethBalance > 0n;

      if (hasETH) {
        assetsToPoke.push({ asset: ETH, market: null });
      }

      for (const { asset, market, balance } of assetBalances) {
        if (hasETH && asset === WETH) continue;

        if (balance > 0n) {
          assetsToPoke.push({ asset, market });
        }
      }

      const pokePromises = assetsToPoke.map(({ asset, market }) =>
        withRetry(
          () =>
            base.exaSend(
              {
                name: "poke account",
                op: "exa.poke",
                attributes: { account: accountAddress, asset },
              },
              asset === ETH
                ? {
                    address: accountAddress,
                    abi: combinedAccountAbi,
                    functionName: "pokeETH",
                  }
                : {
                    address: accountAddress,
                    abi: combinedAccountAbi,
                    functionName: "poke",
                    args: [market],
                  },
              ...(options?.ignore ? [{ ignore: options.ignore }] : []),
            ),
          {
            delay: 2000,
            retryCount: 5,
            shouldRetry: ({ error }) => {
              captureException(error, { level: "warning" });
              return true;
            },
          },
        ),
      );

      const results = await Promise.allSettled(pokePromises);
      for (const result of results) {
        if (result.status === "rejected") captureException(result.reason);
      }

      const successCount = results.filter((result) => result.status === "fulfilled").length;

      if (options?.notification && successCount > 0) {
        sendPushNotification({
          userId: accountAddress,
          headings: options.notification.headings,
          contents: options.notification.contents,
        }).catch((error: unknown) => captureException(error));
      }
    },
  };
}
