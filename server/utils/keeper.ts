import { captureException } from "@sentry/node";
import { parse } from "valibot";
import {
  createWalletClient,
  erc20Abi,
  http,
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
      const marketsByAsset = await publicClient
        .readContract({ address: exaPreviewerAddress, functionName: "assets", abi: exaPreviewerAbi })
        .then((p) => new Map<Address, Address>(p.map((m) => [parse(Address, m.asset), parse(Address, m.market)])));

      const assetsToPoke: { asset: Address; market: Address | null }[] = [];

      const settled = await Promise.allSettled([
        publicClient
          .getBalance({ address: accountAddress })
          .then((balance): { asset: Address; balance: bigint; market: Address | null } => ({
            asset: ETH,
            market: null,
            balance,
          })),
        ...[...marketsByAsset.entries()].map(async ([asset, market]) => ({
          asset,
          market,
          balance: await publicClient.readContract({
            address: asset,
            functionName: "balanceOf",
            args: [accountAddress],
            abi: erc20Abi,
          }),
        })),
      ]).then((s) => {
        return s.flatMap((result) => {
          if (result.status === "rejected") {
            captureException(result.reason, { level: "error" });
            return [];
          }
          return [result.value];
        });
      });

      const hasETH = settled.some((r) => r.asset === ETH && r.balance > 0n);
      for (const { asset, market, balance } of settled) {
        if (hasETH && asset === WETH) continue;
        if (balance > 0n) assetsToPoke.push({ asset, market });
      }

      const pokes = await Promise.allSettled(
        assetsToPoke.map(({ asset, market }) =>
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
        ),
      ).then((r) => {
        return r.flatMap((result) => {
          if (result.status === "rejected") {
            captureException(result.reason, { level: "error" });
            return [];
          }

          return result.value ?? [];
        });
      });

      if (options?.notification && pokes.length > 0) {
        sendPushNotification({
          userId: accountAddress,
          headings: options.notification.headings,
          contents: options.notification.contents,
        }).catch((error: unknown) => captureException(error, { level: "error" }));
      }
    },
  };
}
