import React, { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { router } from "expo-router";

import { ArrowLeft, Check, CircleHelp, Repeat, TriangleAlert } from "@tamagui/lucide-icons";
import { Checkbox, ScrollView, Separator, Spinner, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { parse } from "valibot";
import { formatUnits, parseUnits, zeroAddress } from "viem";
import { useSimulateContract, useWriteContract } from "wagmi";

import {
  auditorAbi,
  marketAbi,
  upgradeableModularAccountAbi,
  useReadPreviewerExactly,
} from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";
import { Address } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";

import Failure from "./Failure";
import Pending from "./Pending";
import TokenSelectModal from "./SelectorModal";
import Success from "./Success";
import SwapDetails from "./SwapDetails";
import TokenInput from "./TokenInput";
import { presentArticle } from "../../utils/intercom";
import { getAllowTokens, getRoute, getRouteFrom } from "../../utils/lifi";
import openBrowser from "../../utils/openBrowser";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAccountAssets from "../../utils/useAccountAssets";
import useAsset from "../../utils/useAsset";
import useSimulateProposal from "../../utils/useSimulateProposal";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Token } from "@lifi/sdk";

export type Swap = {
  enableSimulations: boolean;
  fromAmount: bigint;
  fromToken?: { external: boolean; token: Token };
  toAmount: bigint;
  tokenModalOpen: boolean;
  tokenSelectionType: "from" | "to";
  tool: string;
  toToken?: { external: boolean; token: Token };
};

const defaultSwap: Swap = {
  fromToken: undefined,
  toToken: undefined,
  fromAmount: 0n,
  toAmount: 0n,
  tokenSelectionType: "to",
  enableSimulations: true,
  tokenModalOpen: false,
  tool: "",
};

const SLIPPAGE_PERCENT = 5n;

export default function Swaps() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { address: account } = useAccount();
  const { externalAssets, protocolAssets } = useAccountAssets();
  const [acknowledged, setAcknowledged] = useState(false);
  const [activeInput, setActiveInput] = useState<"from" | "to">("from");
  const { data: markets } = useReadPreviewerExactly({ args: [account ?? zeroAddress] });
  const { data: tokens, isLoading: isTokensLoading } = useQuery({ queryKey: ["allowTokens"], queryFn: getAllowTokens });
  const {
    data: {
      fromToken,
      toToken,
      fromAmount,
      toAmount,
      tokenSelectionType,
      enableSimulations,
      tokenModalOpen,
      tool,
    } = defaultSwap,
  } = useQuery<Swap>({
    queryKey: ["swap"],
    queryFn: () => defaultSwap,
  });

  const isExternal = useCallback(
    (address: string) => {
      if (!markets) return false;
      return !markets.some((m) => parse(Address, m.asset) === parse(Address, address));
    },
    [markets],
  );

  const getSwapAddress = useCallback(
    (token: undefined | { external: boolean; token: Token }) => {
      if (!token) return;
      if (token.external) return parse(Address, token.token.address);
      return protocolAssets.find((a) => a.asset === token.token.address)?.market ?? zeroAddress;
    },
    [protocolAssets],
  );

  const getBalance = useCallback(
    (token?: Token) => {
      if (!token) return 0n;
      if (isExternal(token.address)) {
        return externalAssets.find((a) => a.address === token.address)?.amount ?? 0n;
      }
      return protocolAssets.find((a) => a.asset === token.address)?.floatingDepositAssets ?? 0n;
    },
    [externalAssets, isExternal, protocolAssets],
  );

  const { market: selectedTokenMarket, available: selectedTokenAvailable } = useAsset(getSwapAddress(fromToken));

  const isInsufficientBalance = useMemo(() => {
    if (!fromToken || !toToken) return false;
    return fromAmount > getBalance(fromToken.token);
  }, [fromToken, toToken, fromAmount, getBalance]);

  useEffect(() => {
    if (!fromToken && !toToken && tokens && markets) {
      const usdc = tokens.find(({ symbol }) => symbol === "USDC");
      const exa = tokens.find(({ symbol }) => symbol === "EXA");
      if (usdc && exa) {
        updateSwap((old) => ({
          ...old,
          fromToken: { token: usdc, external: isExternal(usdc.address) },
          toToken: { token: exa, external: isExternal(exa.address) },
        }));
      }
    }
  }, [fromToken, isExternal, markets, toToken, tokens]);

  const handleTokenSelect = (token: Token) => {
    if (!fromToken || !toToken) return;
    updateSwap((old) => ({
      ...old,
      fromAmount: 0n,
      toAmount: 0n,
      fromToken:
        tokenSelectionType === "from"
          ? { token, external: isExternal(token.address) }
          : token.address === fromToken.token.address
            ? { token: toToken.token, external: toToken.external }
            : fromToken,
      toToken:
        tokenSelectionType === "to"
          ? { token, external: isExternal(token.address) }
          : token.address === toToken.token.address
            ? { token: fromToken.token, external: fromToken.external }
            : toToken,
      tokenModalOpen: false,
    }));
  };

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const handleAmountChange = (value: bigint, type: "from" | "to") => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const token = type === "from" ? fromToken : toToken;
      if (!token?.token) return;
      updateSwap((old) => ({
        ...old,
        fromAmount: type === "from" ? value : old.fromAmount,
        toAmount: type === "to" ? value : old.toAmount,
      }));
    }, 400);
  };

  useEffect(() => {
    return () => {
      queryClient.removeQueries({ queryKey: ["swap"] });
    };
  }, []);

  const {
    data: route,
    error: routeError,
    isLoading: isRouteLoading,
  } = useQuery({
    queryKey: [
      "lifi",
      "route",
      account,
      fromToken,
      toToken,
      activeInput,
      activeInput === "from" ? fromAmount : toAmount,
    ],
    queryFn: async () => {
      if (!account || !fromToken || !toToken) throw new Error("implementation error");
      const fromTokenAddress = parse(Address, fromToken.token.address);
      const toTokenAddress = parse(Address, toToken.token.address);
      if (activeInput === "from") {
        const result = await getRouteFrom({
          fromTokenAddress,
          toTokenAddress,
          fromAmount,
          fromAddress: account,
          toAddress: account,
        });
        return { ...result, toAmount: result.toAmount, fromAmount: undefined, tool: result.tool };
      } else {
        const result = await getRoute(fromTokenAddress, toTokenAddress, toAmount, account, account);
        return { ...result, fromAmount: result.fromAmount, toAmount: undefined, tool: result.tool };
      }
    },
    enabled:
      enableSimulations &&
      !!account &&
      !!fromToken &&
      !!toToken &&
      (activeInput === "from" ? !!fromAmount : !!toAmount),
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (route) {
      if (activeInput === "from") {
        updateSwap((old) => ({ ...old, toAmount: route.toAmount ?? 0n, tool: route.tool ?? "" }));
      } else {
        updateSwap((old) => ({ ...old, fromAmount: route.fromAmount ?? 0n, tool: route.tool ?? "" }));
      }
    }
  }, [activeInput, route]);

  useEffect(() => {
    if (route) {
      updateSwap((old) => {
        return activeInput === "from"
          ? { ...old, toAmount: route.toAmount ?? 0n, tool: route.tool ?? "" }
          : { ...old, fromAmount: route.fromAmount ?? 0n, tool: route.tool ?? "" };
      });
    }
  }, [activeInput, route]);

  const {
    propose: { data: swapPropose },
    executeProposal: { error: swapExecuteProposalError, isPending: isSimulatingSwap },
  } = useSimulateProposal({
    account,
    amount: activeInput === "from" ? fromAmount : (fromAmount * (WAD * (1000n + SLIPPAGE_PERCENT))) / 1000n / WAD,
    market: getSwapAddress(fromToken),
    proposalType: ProposalType.Swap,
    assetOut: parse(Address, toToken?.token.address ?? zeroAddress),
    minAmountOut: activeInput === "from" ? (toAmount * (WAD * (1000n - SLIPPAGE_PERCENT))) / 1000n / WAD : toAmount,
    route: route?.data,
    enabled:
      enableSimulations &&
      !!account &&
      !!fromToken &&
      !!toToken &&
      !!fromAmount &&
      fromAmount > 0n &&
      !!toAmount &&
      toAmount > 0n &&
      !!route &&
      !isInsufficientBalance &&
      !fromToken.external,
  });

  const {
    data: externalSwap,
    error: externalSwapError,
    isPending: isSimulatingExternalSwap,
  } = useSimulateContract({
    address: account,
    functionName: "swap",
    args: [
      parse(Address, fromToken?.token.address ?? zeroAddress),
      parse(Address, toToken?.token.address ?? zeroAddress),
      activeInput === "from" ? fromAmount : (fromAmount * (WAD * (1000n + SLIPPAGE_PERCENT))) / 1000n / WAD,
      activeInput === "from" ? (toAmount * (WAD * (1000n - SLIPPAGE_PERCENT))) / 1000n / WAD : toAmount,
      route?.data ?? "0x",
    ],
    abi: [
      ...auditorAbi,
      ...marketAbi,
      ...upgradeableModularAccountAbi,
      {
        type: "function",
        inputs: [
          { name: "assetIn", internalType: "contract IERC20", type: "address" },
          { name: "assetOut", internalType: "contract IERC20", type: "address" },
          { name: "maxAmountIn", internalType: "uint256", type: "uint256" },
          { name: "minAmountOut", internalType: "uint256", type: "uint256" },
          { name: "route", internalType: "bytes", type: "bytes" },
        ],
        name: "swap",
        outputs: [
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
        stateMutability: "nonpayable",
      },
    ],
    query: {
      enabled:
        enableSimulations &&
        !!account &&
        !!fromToken &&
        !!toToken &&
        !!fromAmount &&
        fromAmount > 0n &&
        !!toAmount &&
        toAmount > 0n &&
        !!route &&
        fromToken.external &&
        !isInsufficientBalance,
    },
  });

  const simulationError = {
    external: externalSwapError ?? routeError,
    protocol: swapExecuteProposalError,
  }[fromToken?.external ? "external" : "protocol"];

  const isSimulating = {
    external: isSimulatingExternalSwap,
    protocol: isSimulatingSwap,
  }[fromToken?.external ? "external" : "protocol"];

  const { mutate, isPending: isSwapping, isSuccess: isSwapSuccess, error: writeContractError } = useWriteContract({});

  const handleSwap = useCallback(() => {
    if (!route) return;
    if (fromToken?.external && externalSwap) {
      mutate(externalSwap.request);
    } else if (swapPropose) {
      mutate(swapPropose.request);
    }
    updateSwap((old) => ({ ...old, enableSimulations: false }));
  }, [route, fromToken?.external, externalSwap, swapPropose, mutate]);

  const toTokenIsUSDC = toToken?.token.symbol === "USDC";
  const caution =
    !fromToken?.external &&
    !toTokenIsUSDC &&
    aboveThreshold(fromAmount, selectedTokenAvailable, 75, selectedTokenMarket?.decimals ?? 0);
  const danger =
    !fromToken?.external &&
    !toTokenIsUSDC &&
    aboveThreshold(fromAmount, selectedTokenAvailable, 90, selectedTokenMarket?.decimals ?? 0);

  const showWarning = fromToken && !fromToken.external && fromAmount > 0n && (caution || danger);
  const disabled = isSimulating || !!simulationError || danger;
  const buttonLabel = useMemo(() => {
    if (isSimulating && route) return isInsufficientBalance ? t("Insufficient balance") : t("Please wait...");
    if (simulationError) return t("Cannot proceed");
    if (danger) return t("Enter a lower amount to swap");
    if (fromToken && toToken) {
      return t("Swap {{from}} for {{to}}", { from: fromToken.token.symbol, to: toToken.token.symbol });
    }
    return t("Swap");
  }, [isSimulating, route, isInsufficientBalance, simulationError, danger, fromToken, toToken, t]);

  if (!isSwapping && !isSwapSuccess && !writeContractError)
    return (
      <SafeView fullScreen backgroundColor="$backgroundSoft">
        <View
          padded
          flexDirection="row"
          gap={10}
          paddingBottom="$s4"
          justifyContent="space-between"
          alignItems="center"
        >
          <Pressable
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(main)/(home)/defi");
              }
            }}
          >
            <ArrowLeft size={24} color="$uiNeutralPrimary" />
          </Pressable>
          <Text primary emphasized subHeadline>
            {t("Swaps")}
          </Text>
          <Pressable
            onPress={() => {
              presentArticle("11757863").catch(reportError);
            }}
          >
            <CircleHelp color="$uiNeutralPrimary" />
          </Pressable>
        </View>
        <ScrollView ref={swapsScrollReference} showsVerticalScrollIndicator={false} flex={1}>
          <View padded>
            <YStack paddingBottom="$s3" gap="$s4_5">
              <YStack gap="$s3_5">
                {(["from", "to"] as const).map((type) => {
                  const tokenData = type === "from" ? fromToken : toToken;
                  const amount = type === "from" ? fromAmount : toAmount;
                  const isActive = activeInput === type;
                  return (
                    <TokenInput
                      key={type}
                      label={t(type === "from" ? "You pay" : "You receive")}
                      token={tokenData?.token}
                      amount={amount}
                      balance={getBalance(tokenData?.token)}
                      disabled={type === "to"}
                      isLoading={isTokensLoading || isRouteLoading}
                      isActive={isActive}
                      isDanger={type === "from" && showWarning}
                      onTokenSelect={() => {
                        updateSwap((old) => ({ ...old, tokenSelectionType: type, tokenModalOpen: true }));
                        setAcknowledged(false);
                      }}
                      onFocus={() => {
                        setActiveInput(type);
                        setAcknowledged(false);
                      }}
                      onChange={(value: bigint) => {
                        handleAmountChange(value, type);
                        setAcknowledged(false);
                      }}
                      onUseMax={(value: bigint) => {
                        handleAmountChange(value, type);
                        setAcknowledged(false);
                      }}
                    />
                  );
                })}
              </YStack>
              {fromToken && toToken && route && (
                <SwapDetails
                  exchange={tool}
                  slippage={SLIPPAGE_PERCENT}
                  exchangeRate={getExchangeRate(fromToken.token, toToken.token, fromAmount, toAmount)}
                  fromToken={fromToken.token}
                  toToken={toToken.token}
                />
              )}
            </YStack>
          </View>
        </ScrollView>
        <YStack padding="$s4" paddingBottom={insets.bottom} gap="$s2_5">
          <YStack gap="$s3">
            {(caution || danger) && showWarning && (
              <YStack gap="$s4_5">
                <Separator borderColor={danger ? "$borderErrorStrong" : "$borderNeutralSoft"} />
                <XStack
                  gap="$s3"
                  alignItems="center"
                  cursor="pointer"
                  onPress={() => {
                    setAcknowledged(!acknowledged);
                  }}
                >
                  {danger ? (
                    <TriangleAlert size={16} color="$uiErrorSecondary" />
                  ) : (
                    <Checkbox
                      pointerEvents="none"
                      borderColor="$backgroundBrand"
                      backgroundColor={acknowledged ? "$backgroundBrand" : "transparent"}
                      checked={acknowledged}
                    >
                      <Checkbox.Indicator>
                        <Check size={16} color="$uiNeutralPrimary" />
                      </Checkbox.Indicator>
                    </Checkbox>
                  )}
                  <Text caption color={danger ? "$uiErrorSecondary" : "$uiNeutralSecondary"} flex={1}>
                    {danger
                      ? t(
                          "Swapping this much of your collateral could instantly trigger liquidation. Try a smaller amount to stay protected.",
                        )
                      : t("I acknowledge the risks of swapping this much of my collateral assets.")}
                  </Text>
                </XStack>
                <Separator borderColor="$borderNeutralSoft" />
              </YStack>
            )}
            <XStack alignItems="flex-start" flexWrap="wrap" paddingBottom="$s3">
              <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
                <Trans
                  i18nKey="Swap functionality is provided via <link>LI.FI</link> and executed on decentralized networks. Availability and pricing depend on network conditions and third-party protocols."
                  components={{
                    link: (
                      <Text
                        cursor="pointer"
                        caption2
                        color="$interactiveOnDisabled"
                        textDecorationLine="underline"
                        onPress={() => {
                          openBrowser(`https://li.fi/`).catch(reportError);
                        }}
                      />
                    ),
                  }}
                />
              </Text>
            </XStack>
          </YStack>
          <Button
            onPress={handleSwap}
            contained
            main
            spaced
            fullwidth
            danger={caution && acknowledged}
            disabled={disabled || (caution && !acknowledged)}
            iconAfter={
              danger ? (
                <TriangleAlert size={16} color="$interactiveOnDisabled" />
              ) : isSimulating && route && !isInsufficientBalance ? (
                <Spinner color="$interactiveOnDisabled" />
              ) : (
                <Repeat
                  strokeWidth={2.5}
                  color={
                    disabled || (caution && !acknowledged)
                      ? "$interactiveOnDisabled"
                      : caution && acknowledged
                        ? "$interactiveOnBaseErrorSoft"
                        : caution && !acknowledged
                          ? "$interactiveOnBaseErrorSoft"
                          : "$interactiveOnBaseBrandDefault"
                  }
                />
              )
            }
          >
            {buttonLabel}
          </Button>
        </YStack>
        <TokenSelectModal
          withBalanceOnly={tokenSelectionType === "from"}
          open={tokenModalOpen}
          tokens={tokens ?? []}
          selectedToken={tokenSelectionType === "from" ? fromToken?.token : toToken?.token}
          onSelect={handleTokenSelect}
          onClose={() => updateSwap((old) => ({ ...old, tokenModalOpen: false }))}
          isLoading={isTokensLoading}
          title={tokenSelectionType === "from" ? t("Select token to pay") : t("Select token to receive")}
        />
      </SafeView>
    );
  {
    if (!fromToken || !toToken) return null;
    const properties = {
      fromUsdAmount: Number(
        formatUnits((fromAmount * parseUnits(fromToken.token.priceUSD, 18)) / WAD, fromToken.token.decimals),
      ),
      fromAmount,
      fromToken: fromToken.token,
      toUsdAmount: Number(
        formatUnits((toAmount * parseUnits(toToken.token.priceUSD, 18)) / WAD, toToken.token.decimals),
      ),
      toAmount,
      toToken: toToken.token,
    };
    if (isSwapping)
      return (
        <Pending
          {...properties}
          onClose={() => {
            onClose();
          }}
        />
      );
    if (isSwapSuccess)
      return (
        <Success
          {...properties}
          onClose={() => {
            onClose();
          }}
        />
      );
    return (
      <Failure
        {...properties}
        onClose={() => {
          onClose();
        }}
      />
    );
  }
}

function onClose() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(main)/(home)");
  }
}

function aboveThreshold(amount: bigint, available: bigint, threshold: number, decimals: number) {
  return Number(formatUnits(amount, decimals)) >= Number(formatUnits((available * BigInt(threshold)) / 100n, decimals));
}

function getExchangeRate(fromToken: Token, toToken: Token, fromAmount: bigint, toAmount: bigint) {
  return Number(formatUnits(toAmount, toToken.decimals)) / Number(formatUnits(fromAmount, fromToken.decimals));
}

function updateSwap(updater: (old: Swap) => Swap) {
  queryClient.setQueryData<Swap>(["swap"], (old) => updater(old ?? defaultSwap));
}

export const swapsScrollReference: RefObject<null | ScrollView> = { current: null };
