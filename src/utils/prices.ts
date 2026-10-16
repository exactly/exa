import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { array, boolean, nullish, object, parse, string } from "valibot";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  formatUnits,
  getAddress,
  zeroAddress,
} from "viem";
import { arbitrum, base, bsc, mainnet, optimism, polygon } from "viem/chains";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain, { allowlists, auditorAddress, pricePreviewerCode } from "@exactly/common/generated/chain";
import { useReadPricePreviewerFeeds, useReadPricePreviewerPrices } from "@exactly/common/generated/hooks";

import alchemyChains from "./alchemyChains";
import { isStock, marketOpen } from "./lifi";

export const ranges = { "1D": 24 * 60 * 60, "1W": 7 * 24 * 60 * 60, "1M": 30 * 24 * 60 * 60 } as const;

export function defaultRange(token: { address: string; chainId: number }): keyof typeof ranges {
  return isStock(token) && !marketOpen() ? "1W" : "1D";
}

export function useHistory(
  token: { address: string; chainId: number; symbol: string },
  range: keyof typeof ranges,
  count = 289,
) {
  const feed = useFeed(token);
  const onchain = useReadPricePreviewerPrices({
    code: pricePreviewerCode,
    chainId: token.chainId,
    args: feed ? [feed.address, BigInt(ranges[range] / (count - 1)), BigInt(count)] : undefined,
    query: {
      enabled: !!feed,
      staleTime: 60_000,
      placeholderData: keepPreviousData,
      retry: (failures, error) => failures < 3 && !reverted(error),
      meta: { dropError: reverted, warnError: () => true },
      select: ([decimals, updated, prices]) =>
        updated
          ? {
              points: prices.flatMap(({ timestamp, answer }) =>
                timestamp
                  ? [{ timestamp: Number(timestamp) * 1000, value: Number(formatUnits(answer, decimals)) }]
                  : [],
              ),
              updated: Number(updated) * 1000,
            }
          : null,
    },
  });
  const fallback = feed === null || reverted(onchain.error);
  const alchemy = useQuery({
    queryKey: ["prices", token.chainId, token.address.toLowerCase(), range],
    enabled: fallback,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    meta: { warnError: () => true },
    queryFn: async () => {
      const network = alchemyChains.get(token.chainId);
      const url = network?.rpcUrls.alchemy?.http[0];
      if (!network || !url) return null;
      const now = Math.floor(Date.now() / 1000);
      const response = await fetch(`https://api.g.alchemy.com/prices/v1/${alchemyAPIKey}/tokens/historical`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(token.address === zeroAddress
            ? { symbol: network.nativeCurrency.symbol }
            : { network: new URL(url).hostname.split(".")[0], address: token.address }),
          startTime: new Date((now - ranges[range]) * 1000).toISOString(),
          endTime: new Date(now * 1000).toISOString(),
          interval: range === "1D" ? "5m" : "1h",
        }),
      });
      if (response.status === 400) return null;
      if (!response.ok) throw new Error(`alchemy prices failed: ${response.status} ${await response.text()}`);
      const points = parse(
        object({ data: array(object({ timestamp: string(), value: string() })) }),
        await response.json(),
      ).data.map(({ timestamp, value }) => ({ timestamp: new Date(timestamp).getTime(), value: Number(value) }));
      const last = points.at(-1);
      return last ? { points, updated: last.timestamp } : null;
    },
  });
  return fallback ? alchemy : onchain;
}

export function useFeed(token?: { address: string; chainId: number; symbol: string }) {
  const chainId = token?.chainId ?? chain.id;
  const markets = useReadPricePreviewerFeeds({
    code: pricePreviewerCode,
    chainId: chain.id,
    args: [auditorAddress],
    query: { enabled: chainId === chain.id, staleTime: 24 * 60 * 60_000 },
  });
  const feeds = useQuery({
    queryKey: ["feeds", chainId],
    staleTime: 24 * 60 * 60_000,
    gcTime: Infinity,
    meta: { warnError: () => true },
    queryFn: async () => {
      const directory = new Map<number, string>([
        [mainnet.id, "mainnet"],
        [optimism.id, "ethereum-mainnet-optimism-1"],
        [bsc.id, "bsc-mainnet"],
        [polygon.id, "matic-mainnet"],
        [base.id, "ethereum-mainnet-base-1"],
        [arbitrum.id, "ethereum-mainnet-arbitrum-1"],
      ]).get(chainId);
      if (!directory) return {};
      const response = await fetch(`https://reference-data-directory.vercel.app/feeds-${directory}.json`);
      if (!response.ok) throw new Error(`feeds failed: ${response.status} ${await response.text()}`);
      return Object.fromEntries(
        parse(
          array(
            object({
              docs: object({
                assetSubClass: nullish(string()),
                hidden: nullish(boolean()),
                shutdownDate: nullish(string()),
              }),
              ens: nullish(string()),
              path: string(),
              proxyAddress: nullish(string()),
              secondaryProxyAddress: nullish(string()),
              secondaryProxyEns: nullish(string()),
            }),
          ),
          await response.json(),
        )
          .filter(({ docs }) => !docs.hidden && !docs.shutdownDate)
          .flatMap(({ docs, ens, path, proxyAddress, secondaryProxyAddress, secondaryProxyEns }) =>
            [
              [secondaryProxyEns, secondaryProxyAddress],
              [ens, proxyAddress],
              [path, proxyAddress],
            ].flatMap(([name, address]) => {
              const asset = name && /^(.+)-usd$/.exec(name)?.[1];
              return asset && address
                ? [[asset, { address: getAddress(address), stablecoin: docs.assetSubClass === "Stablecoin" }] as const]
                : [];
            }),
          ),
      );
    },
  });
  if (!token) return null;
  if ((chainId === chain.id && markets.isPending) || feeds.isPending) return;
  const address = getAddress(token.address);
  const market = chainId === chain.id ? markets.data?.find(({ asset }) => asset === address)?.feed : undefined;
  if (address !== zeroAddress && !market && !allowlists[chainId]?.includes(address)) return null;
  const symbol = token.symbol.toLowerCase();
  const named = isStock(token)
    ? feeds.data?.[`cb${symbol.slice(0, -1)}`]
    : (feeds.data?.[symbol] ??
      feeds.data?.[
        new Map([
          ["usdc.e", "usdc"],
          ["usdt0", "usdt"],
          ["wbtc", "btc"],
          ["weth", "eth"],
        ]).get(symbol) ?? symbol
      ]);
  return market ? { address: market, stablecoin: !!named?.stablecoin } : (named ?? null);
}

function reverted(error: unknown) {
  return error instanceof ContractFunctionExecutionError && error.cause instanceof ContractFunctionRevertedError;
}
