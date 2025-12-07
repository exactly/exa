import ProposalType from "@exactly/common/ProposalType";
import { previewerAddress } from "@exactly/common/generated/chain";
import {
  auditorAbi,
  marketAbi,
  upgradeableModularAccountAbi,
  useReadPreviewerExactly,
} from "@exactly/common/generated/hooks";
import { Address } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";
import type { Token } from "@lifi/sdk";
import { ArrowLeft, Check, CircleHelp, Repeat, TriangleAlert } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Checkbox, ScrollView, Separator, Spinner, XStack, YStack } from "tamagui";
import { parse } from "valibot";
import { formatUnits, parseUnits, zeroAddress } from "viem";
import { useSimulateContract, useWriteContract } from "wagmi";

import Failure from "./Failure";
import Pending from "./Pending";
import TokenSelectModal from "./SelectorModal";
import Success from "./Success";
import SwapDetails from "./SwapDetails";
import TokenInput from "./TokenInput";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import { getAllowTokens, getRoute, getRouteFrom } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAccountAssets from "../../utils/useAccountAssets";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import useOpenBrowser from "../../utils/useOpenBrowser";
import useSimulateProposal from "../../utils/useSimulateProposal";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export interface Swap {
  fromToken?: { token: Token; external: boolean };
  toToken?: { token: Token; external: boolean };
  fromAmount: bigint;
  toAmount: bigint;
  tokenSelectionType: "from" | "to";
  enableSimulations: boolean;
  tokenModalOpen: boolean;
  tool: string;
}

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
  const navigation = useNavigation<AppNavigationProperties>();
  const insets = useSafeAreaInsets();
  const openBrowser = useOpenBrowser();
  const { presentArticle } = useIntercom();
  const { address: account } = useAccount();
  const { externalAssets, protocolAssets } = useAccountAssets();
  const [acknowledged, setAcknowledged] = useState(false);
  const [activeInput, setActiveInput] = useState<"from" | "to">("from");
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });
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

  const updateSwap = useCallback((updater: (old: Swap) => Swap) => {
    queryClient.setQueryData<Swap>(["swap"], (old) => updater(old ?? defaultSwap));
  }, []);

  const isExternal = useCallback(
    (address: string) => {
      if (!markets) return false;
      return !markets.some((m) => parse(Address, m.asset) === parse(Address, address));
    },
    [markets],
  );

  const getSwapAddress = useCallback(
    (token: { external: boolean; token: Token } | undefined) => {
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
      const usdc = tokens.find((t) => t.symbol === "USDC");
      const exa = tokens.find((t) => t.symbol === "EXA");
      if (usdc && exa) {
        updateSwap((old) => ({
          ...old,
          fromToken: { token: usdc, external: isExternal(usdc.address) },
          toToken: { token: exa, external: isExternal(exa.address) },
        }));
      }
    }
  }, [fromToken, isExternal, markets, toToken, tokens, updateSwap]);

  const handleSelectToken = (type: "from" | "to") => {
    updateSwap((old) => ({ ...old, tokenSelectionType: type, tokenModalOpen: true }));
  };

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

  const handleCloseTokenModal = () => {
    updateSwap((old) => ({ ...old, tokenModalOpen: false }));
  };

  const debounceReference = useRef<ReturnType<typeof setTimeout>>();
  const handleAmountChange = (value: bigint, type: "from" | "to") => {
    if (debounceReference.current) clearTimeout(debounceReference.current);
    debounceReference.current = setTimeout(() => {
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
  }, [activeInput, route, updateSwap]);

  useEffect(() => {
    if (route) {
      updateSwap((old) => {
        return activeInput === "from"
          ? { ...old, toAmount: route.toAmount ?? 0n, tool: route.tool ?? "" }
          : { ...old, fromAmount: route.fromAmount ?? 0n, tool: route.tool ?? "" };
      });
    }
  }, [activeInput, route, updateSwap]);

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

  const {
    writeContract,
    isPending: isSwapping,
    isSuccess: isSwapSuccess,
    error: writeContractError,
  } = useWriteContract({});

  const handleSwap = useCallback(() => {
    if (!route) return;
    if (fromToken?.external && externalSwap) {
      writeContract(externalSwap.request);
    } else if (swapPropose) {
      writeContract(swapPropose.request);
    }
    updateSwap((old) => ({ ...old, enableSimulations: false }));
  }, [route, fromToken?.external, externalSwap, swapPropose, writeContract, updateSwap]);

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
            aria-label="Back"
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.replace("(home)", { screen: "defi" });
              }
            }}
          >
            <ArrowLeft size={24} color="$uiNeutralPrimary" />
          </Pressable>
          <Text primary emphasized subHeadline>
            Swaps
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
                      label={type === "from" ? "You pay" : "You receive"}
                      token={tokenData?.token}
                      amount={amount}
                      balance={getBalance(tokenData?.token)}
                      disabled={type === "to"}
                      isLoading={isTokensLoading || isRouteLoading}
                      isActive={isActive}
                      isDanger={type === "from" && showWarning}
                      onTokenSelect={() => {
                        handleSelectToken(type);
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
                      ? "Swapping this much of your collateral could instantly trigger liquidation. Try a smaller amount to stay protected."
                      : "I acknowledge the risks of swapping this much of my collateral assets."}
                  </Text>
                </XStack>
                <Separator borderColor="$borderNeutralSoft" />
              </YStack>
            )}
            <XStack alignItems="flex-start" flexWrap="wrap" paddingBottom="$s3">
              <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
                Swap functionality is provided via&nbsp;
                <Text
                  cursor="pointer"
                  caption2
                  color="$interactiveOnDisabled"
                  textDecorationLine="underline"
                  onPress={() => {
                    openBrowser(`https://li.fi/`).catch(reportError);
                  }}
                >
                  LI.FI
                </Text>
                &nbsp; and executed on decentralized networks. Availability and pricing depend on network conditions and
                third-party protocols.
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
            {isSimulating && route
              ? isInsufficientBalance
                ? "Insufficient balance"
                : "Please wait..."
              : simulationError
                ? "Cannot proceed"
                : danger
                  ? "Enter a lower amount to swap"
                  : `Swap ${fromToken?.token.symbol} for ${toToken?.token.symbol}`}
          </Button>
        </YStack>
        <TokenSelectModal
          withBalanceOnly={tokenSelectionType === "from"}
          open={tokenModalOpen}
          tokens={tokens ?? []}
          selectedToken={tokenSelectionType === "from" ? fromToken?.token : toToken?.token}
          onSelect={handleTokenSelect}
          onClose={handleCloseTokenModal}
          isLoading={isTokensLoading}
          title={tokenSelectionType === "from" ? "Select token to pay" : "Select token to receive"}
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
            onClose(navigation);
          }}
        />
      );
    if (isSwapSuccess)
      return (
        <Success
          {...properties}
          onClose={() => {
            onClose(navigation);
          }}
        />
      );
    return (
      <Failure
        {...properties}
        onClose={() => {
          onClose(navigation);
        }}
      />
    );
  }
}

function onClose(navigation: AppNavigationProperties) {
  if (navigation.canGoBack()) {
    navigation.goBack();
  } else {
    navigation.replace("(main)");
  }
}

function aboveThreshold(amount: bigint, available: bigint, threshold: number, decimals: number) {
  return Number(formatUnits(amount, decimals)) >= Number(formatUnits((available * BigInt(threshold)) / 100n, decimals));
}

function getExchangeRate(fromToken: Token, toToken: Token, fromAmount: bigint, toAmount: bigint) {
  return Number(formatUnits(toAmount, toToken.decimals)) / Number(formatUnits(fromAmount, fromToken.decimals));
}

export const swapsScrollReference = React.createRef<ScrollView>();
