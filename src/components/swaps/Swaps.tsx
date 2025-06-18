import ProposalType from "@exactly/common/ProposalType";
import { previewerAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";
import type { Token } from "@lifi/sdk";
import { ArrowLeft, CircleHelp, Repeat } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Spinner, useTheme, XStack, YStack } from "tamagui";
import { parse } from "valibot";
import { formatUnits, parseUnits, zeroAddress } from "viem";
import { useAccount, useSimulateContract, useWriteContract } from "wagmi";

import Failure from "./Failure";
import Pending from "./Pending";
import TokenSelectModal from "./SelectorModal";
import Success from "./Success";
import TokenInput from "./TokenInput";
import {
  auditorAbi,
  marketAbi,
  upgradeableModularAccountAbi,
  useReadPreviewerExactly,
} from "../../generated/contracts";
import { getAllowTokens, getRoute, getRouteFrom } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccountAssets from "../../utils/useAccountAssets";
import useIntercom from "../../utils/useIntercom";
import useSimulateProposal from "../../utils/useSimulateProposal";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export interface Swap {
  fromToken: { token: Token; external: boolean } | undefined;
  toToken: { token: Token; external: boolean } | undefined;
  fromAmount: bigint;
  toAmount: bigint;
  tokenSelectionType: "from" | "to";
  enableSimulations: boolean;
  tokenModalOpen: boolean;
}

const defaultSwap: Swap = {
  fromToken: undefined,
  toToken: undefined,
  fromAmount: 0n,
  toAmount: 0n,
  tokenSelectionType: "to",
  enableSimulations: true,
  tokenModalOpen: false,
};

export default function Swaps() {
  const theme = useTheme();
  const { address: account } = useAccount();
  const { presentArticle } = useIntercom();
  const insets = useSafeAreaInsets();
  const { protocolAssets } = useAccountAssets();
  const { refetch, isPending } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });

  const [activeInput, setActiveInput] = useState<"from" | "to">("to");

  const SLIPPAGE_PERCENT = 5n;
  const style = { backgroundColor: theme.backgroundSoft.val, margin: -5 };

  const { canGoBack } = router;

  function back() {
    router.back();
  }

  const { data: tokens, isLoading: isTokensLoading } = useQuery({
    queryKey: ["allowTokens"],
    queryFn: getAllowTokens,
  });
  const {
    data: {
      fromToken,
      toToken,
      fromAmount,
      toAmount,
      tokenSelectionType,
      enableSimulations,
      tokenModalOpen,
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
      if (!token) return zeroAddress;
      if (token.external) {
        return parse(Address, token.token.address);
      }
      return protocolAssets.find((a) => a.asset === token.token.address)?.market ?? zeroAddress;
    },
    [protocolAssets],
  );

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
    queryKey: ["lifi", "route", account, fromToken, toToken, activeInput, fromAmount, toAmount],
    queryFn: async () => {
      if (!account || !fromToken || !toToken) throw new Error("implementation error");

      const from = parse(Address, fromToken.token.address);
      const to = parse(Address, toToken.token.address);

      if (activeInput === "from") {
        const result = await getRouteFrom(from, to, fromAmount, account, account);
        return {
          ...result,
          toAmount: result.toAmount,
          fromAmount: undefined,
        };
      } else {
        const result = await getRoute(from, to, toAmount, account, account);
        return {
          ...result,
          fromAmount: result.fromAmount,
          toAmount: undefined,
        };
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
        updateSwap((old) => ({ ...old, toAmount: route.toAmount ?? 0n }));
      } else {
        updateSwap((old) => ({ ...old, fromAmount: route.fromAmount ?? 0n }));
      }
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
        fromToken.external,
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

  if (!isSwapping && !isSwapSuccess && !writeContractError)
    return (
      <SafeView fullScreen tab backgroundColor="$backgroundSoft" paddingBottom={0}>
        <View
          padded
          flexDirection="row"
          gap={10}
          paddingBottom="$s4"
          justifyContent="space-between"
          alignItems="center"
        >
          {canGoBack() && (
            <Pressable onPress={back}>
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              presentArticle("10985188").catch(reportError);
            }}
          >
            <CircleHelp color="$uiNeutralPrimary" />
          </Pressable>
        </View>
        <ScrollView
          ref={swapsScrollReference}
          showsVerticalScrollIndicator={false}
          flex={1}
          refreshControl={
            <RefreshControl
              ref={swapsRefreshControlReference}
              style={style}
              refreshing={isPending}
              onRefresh={() => {
                refetch().catch(reportError);
                queryClient.refetchQueries({ queryKey: ["activity"] }).catch(reportError);
              }}
            />
          }
        >
          <View padded>
            <YStack paddingBottom="$s3" gap="$s4_5">
              <XStack gap={10} justifyContent="center" alignItems="center">
                <Text fontSize={20} fontWeight="bold">
                  Exa Swaps
                </Text>
              </XStack>
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
                      external={tokenData?.external}
                      amount={amount}
                      isLoading={isTokensLoading || isRouteLoading}
                      isActive={isActive}
                      onTokenSelect={() => {
                        handleSelectToken(type);
                      }}
                      onFocus={() => {
                        setActiveInput(type);
                      }}
                      onChange={(value: bigint) => {
                        handleAmountChange(value, type);
                      }}
                    />
                  );
                })}
              </YStack>
            </YStack>
          </View>
        </ScrollView>
        <View padded paddingBottom={insets.bottom}>
          <Button
            onPress={() => {
              handleSwap();
            }}
            contained
            disabled={isSimulating || !!simulationError}
            main
            spaced
            fullwidth
            iconAfter={
              isSimulating && route ? (
                <Spinner color="$interactiveOnDisabled" />
              ) : (
                <Repeat strokeWidth={2.5} color="$interactiveOnDisabled" />
              )
            }
          >
            {isSimulating && route ? "Please wait..." : simulationError ? "Cannot proceed" : "Confirm swap"}
          </Button>
        </View>
        <TokenSelectModal
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

    if (isSwapping) return <Pending {...properties} />;
    if (isSwapSuccess) return <Success {...properties} />;
    if (simulationError) return <Failure {...properties} />;

    return null;
  }
}

export const swapsScrollReference = React.createRef<ScrollView>();
export const swapsRefreshControlReference = React.createRef<RefreshControl>();
