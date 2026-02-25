import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ChevronRight, Coins } from "@tamagui/lucide-icons";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { waitForCallsStatus } from "@wagmi/core/actions";
import { digits, nonEmpty, parse, pipe, safeParse, string, transform } from "valibot";
import { ContractFunctionExecutionError, ContractFunctionRevertedError, erc20Abi } from "viem";
import { useBytecode, useReadContract, useSendCalls, useSimulateContract, useWriteContract } from "wagmi";

import accountInit from "@exactly/common/accountInit";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain, {
  balancerVaultAddress,
  exaPluginAddress,
  integrationPreviewerAddress,
  marketUSDCAddress,
  proposalManagerAddress,
  swapperAddress,
  usdcAddress,
} from "@exactly/common/generated/chain";
import {
  auditorAbi,
  integrationPreviewerAbi,
  marketAbi,
  upgradeableModularAccountAbi,
  useReadProposalManagerDelay,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";
import { Address, type Credential } from "@exactly/common/validation";
import { divWad, fixedRepayAssets, fixedRepayPosition, min, WAD } from "@exactly/lib";

import AssetSelectionSheet from "./AssetSelectionSheet";
import RepayAmountSelector from "./RepayAmountSelector";
import SafeView from "../../components/shared/SafeView";
import Button from "../../components/shared/StyledButton";
import Text from "../../components/shared/Text";
import View from "../../components/shared/View";
import { getRoute, getRouteFrom } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import usePortfolio from "../../utils/usePortfolio";
import useSimulateProposal from "../../utils/useSimulateProposal";
import exa from "../../utils/wagmi/exa";
import AssetLogo from "../shared/AssetLogo";
import Failure from "../shared/Failure";
import Pending from "../shared/Pending";
import Skeleton from "../shared/Skeleton";
import Success from "../shared/Success";

export default function Pay() {
  const insets = useSafeAreaInsets();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { address: account } = useAccount();
  const router = useRouter();
  const { assets } = usePortfolio(undefined, { sortBy: "usdcFirst" });
  const { market: exaUSDC } = useAsset(marketUSDCAddress);
  const [enableSimulations, setEnableSimulations] = useState(true);
  const [assetSelectionOpen, setAssetSelectionOpen] = useState(false);
  const [denyExchanges, addDeniedExchange] = useReducer(
    (state: Record<string, boolean>, tool: string) => (state[tool] ? state : { ...state, [tool]: true }),
    {},
  );
  const [manuallySelectedAsset, setManuallySelectedAsset] = useState<{ address?: Address; external: boolean }>({
    external: true,
  });
  const selectedAsset = useMemo(() => {
    if (manuallySelectedAsset.address) return manuallySelectedAsset;
    if (!assets[0]) return manuallySelectedAsset;
    const { type } = assets[0];
    return {
      address: type === "external" ? parse(Address, assets[0].address) : parse(Address, assets[0].market),
      external: type === "external",
    };
  }, [manuallySelectedAsset, assets]);
  const [selectedRepayAssets, setSelectedRepayAssets] = useState<bigint | undefined>();
  const {
    markets,
    externalAsset,
    available: externalAssetAvailable,
    isFetching: isFetchingAsset,
    queryKey: assetQueryKey,
  } = useAsset(selectedAsset.address);
  const [displayValues, setDisplayValues] = useState<{ amount: number; usdAmount: number }>({
    amount: 0,
    usdAmount: 0,
  });
  const { mutateAsync: mutateSendCalls } = useSendCalls();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: bytecode } = useBytecode({ address: account, query: { enabled: !!account } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: account,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: { enabled: !!account && !!credential },
  });
  const withUSDC = selectedAsset.address === (marketUSDCAddress as Address);
  const mode =
    installedPlugins && selectedAsset.address
      ? selectedAsset.external
        ? "external"
        : installedPlugins[0] === exaPluginAddress
          ? withUSDC
            ? "repay"
            : "crossRepay"
          : withUSDC
            ? "legacyRepay"
            : "legacyCrossRepay"
      : "none";

  const { maturity: maturityQuery } = useLocalSearchParams();
  const maturity = useMemo(() => {
    const { success, output } = safeParse(
      pipe(string(), nonEmpty("no maturity"), digits("bad maturity"), transform(BigInt as (input: string) => bigint)),
      maturityQuery,
    );
    if (success) return output;
  }, [maturityQuery]);

  const { data: fixedRepaySnapshot } = useReadContract({
    address: integrationPreviewerAddress,
    abi: integrationPreviewerAbi,
    functionName: "fixedRepaySnapshot",
    args: account ? [account, marketUSDCAddress, maturity ?? 0n] : undefined,
    query: { enabled: !!account && !!bytecode && !!maturity },
  });

  const { data: proposalDelay, isLoading: isProposalDelayLoading } = useReadProposalManagerDelay({
    address: proposalManagerAddress,
  });
  const simulationTimestamp =
    proposalDelay === undefined ? undefined : Math.floor(Date.now() / 1000) + Number(proposalDelay);

  const borrow = exaUSDC?.fixedBorrowPositions.find((b) => b.maturity === maturity);
  const previewValueUSD =
    borrow && exaUSDC ? (borrow.previewValue * exaUSDC.usdPrice) / 10n ** BigInt(exaUSDC.decimals) : 0n;

  const positionValue = borrow ? borrow.position.principal + borrow.position.fee : 0n;

  const positions = markets
    ?.map((market) => ({
      ...market,
      usdValue: (market.floatingDepositAssets * market.usdPrice) / BigInt(10 ** market.decimals),
    }))
    .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0n);

  const repayMarket = positions?.find((p) => p.market === selectedAsset.address);
  const repayMarketAvailable =
    repayMarket && selectedAsset.address && !selectedAsset.external ? repayMarket.floatingDepositAssets : 0n;

  const { data: balancerUSDCBalance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: balancerVaultAddress ? [balancerVaultAddress] : undefined,
    query: {
      enabled: !!account && !!bytecode && !!balancerVaultAddress,
      select: (data) => (data * (WAD * 990n)) / 1000n / WAD,
      refetchInterval: 20_000,
    },
  });

  const { data: routeFrom, isFetching: isRouteFromFetching } = useQuery({
    queryKey: [
      "lifi",
      "routeFrom",
      mode,
      account,
      selectedAsset.address,
      repayMarket?.asset,
      externalAsset ? !!externalAssetAvailable : !!repayMarketAvailable,
    ],
    queryFn: () => {
      switch (mode) {
        case "crossRepay":
        case "legacyCrossRepay":
          if (!account || !repayMarket || !repayMarketAvailable) throw new Error("implementation error");
          return getRouteFrom({
            fromTokenAddress: repayMarket.asset,
            toTokenAddress: usdcAddress,
            fromAmount: repayMarketAvailable,
            fromAddress: account,
            toAddress: mode === "crossRepay" ? account : exaPluginAddress,
            denyExchanges,
          });
        case "external":
          if (!externalAssetAvailable) throw new Error("no external asset available");
          if (!account || !selectedAsset.address) throw new Error("implementation error");
          if (!externalAsset) throw new Error("not external asset");
          return getRouteFrom({
            fromTokenAddress: selectedAsset.address,
            toTokenAddress: usdcAddress,
            fromAmount: externalAssetAvailable,
            fromAddress: account,
            toAddress: account,
            denyExchanges,
          });
        default:
          throw new Error("implementation error");
      }
    },
    enabled:
      enableSimulations &&
      (externalAsset ? !!externalAssetAvailable : !!repayMarketAvailable) &&
      (mode === "crossRepay" || mode === "legacyCrossRepay" || mode === "external"),
    refetchInterval: 20_000,
    placeholderData: keepPreviousData,
  });

  const availableForRepayment = useMemo(() => ((routeFrom?.toAmount ?? 0n) * 97n) / 100n, [routeFrom?.toAmount]);

  const availableUSDC = repayMarket?.market === exaUSDC?.market ? repayMarketAvailable : availableForRepayment;
  const effectiveAvailable = balancerUSDCBalance ? min(balancerUSDCBalance, availableUSDC) : availableUSDC;

  const repayAssetsForFullDebt =
    fixedRepaySnapshot && simulationTimestamp && positionValue > 0n
      ? fixedRepayAssets(fixedRepaySnapshot, Number(maturity ?? 0n), positionValue, simulationTimestamp)
      : undefined;

  const maxRepayInput = repayAssetsForFullDebt ? min(effectiveAvailable, repayAssetsForFullDebt) : 0n;

  const repayAssets = selectedRepayAssets ?? maxRepayInput;

  const positionAssets =
    fixedRepaySnapshot && repayAssets && simulationTimestamp && positionValue > 0n
      ? pad(fixedRepayPosition(fixedRepaySnapshot, Number(maturity ?? 0n), repayAssets, simulationTimestamp))
      : 0n;

  const discountOrPenalty = repayAssets && positionAssets ? divWad(repayAssets, positionAssets) : 0n;
  const discountOrPenaltyPercentage = Number(((WAD - discountOrPenalty) * 10n ** 8n) / WAD) / Number(10n ** 8n);

  const maxRepay = borrow ? (repayAssets ? pad(repayAssets, SLIPPAGE_DIVISOR) : undefined) : 0n;
  const {
    data: route,
    error: routeError,
    isPending: isRoutePending,
    isFetching: isRouteFetching,
  } = useQuery({
    queryKey: ["lifi", "route", mode, account, selectedAsset.address, repayMarket?.asset, maxRepay],
    queryFn: () => {
      if (!maxRepay) throw new Error("no max repay");
      switch (mode) {
        case "crossRepay":
        case "legacyCrossRepay":
          if (!account || !repayMarket) throw new Error("implementation error");
          return getRoute(
            repayMarket.asset,
            usdcAddress,
            maxRepay,
            account,
            mode === "crossRepay" ? account : exaPluginAddress,
            denyExchanges,
          );
        case "external":
          if (!account || !selectedAsset.address) throw new Error("implementation error");
          return getRoute(selectedAsset.address, usdcAddress, maxRepay, account, account, denyExchanges);
        default:
          throw new Error("implementation error");
      }
    },
    enabled:
      enableSimulations &&
      !!maxRepay &&
      (mode === "crossRepay" || mode === "legacyCrossRepay" || mode === "external") &&
      positionAssets > 0n,
    refetchInterval: 20_000,
  });

  const maxAmountIn = route?.fromAmount ? pad(route.fromAmount, SLIPPAGE_DIVISOR) + 69n : undefined; // HACK try to avoid ZERO_SHARES on dust deposit

  const {
    propose: { data: repayPropose },
    executeProposal: { error: repayExecuteProposalError, isPending: isSimulatingRepay },
  } = useSimulateProposal({
    account,
    amount: maxRepay,
    market: selectedAsset.address,
    enabled: enableSimulations && mode === "repay" && positionAssets > 0n,
    proposalType: ProposalType.RepayAtMaturity,
    maturity,
    positionAssets,
  });

  const {
    propose: { data: crossRepayPropose },
    executeProposal: { error: crossRepayExecuteProposalError, isPending: isSimulatingCrossRepay },
  } = useSimulateProposal({
    account,
    amount: maxAmountIn,
    market: selectedAsset.address,
    enabled: enableSimulations && mode === "crossRepay" && positionAssets > 0n,
    proposalType: ProposalType.CrossRepayAtMaturity,
    maturity,
    positionAssets,
    maxRepay,
    route: route?.data,
  });

  const {
    data: legacyRepaySimulation,
    error: legacyRepaySimulationError,
    isPending: isSimulatingLegacyRepay,
  } = useSimulateContract({
    address: account,
    functionName: "repay",
    args: [maturity ?? 0n],
    abi: [
      ...auditorAbi,
      ...marketAbi,
      ...upgradeableModularAccountAbi,
      {
        type: "function",
        inputs: [{ name: "maturity", internalType: "uint256", type: "uint256" }],
        name: "repay",
        outputs: [],
        stateMutability: "nonpayable",
      },
    ],
    query: { enabled: enableSimulations && mode === "legacyRepay" },
  });

  const {
    data: legacyCrossRepaySimulation,
    error: legacyCrossRepaySimulationError,
    isPending: isSimulatingLegacyCrossRepay,
  } = useSimulateContract({
    address: account,
    functionName: "crossRepay",
    args: selectedAsset.address && maturity ? [maturity, selectedAsset.address] : undefined,
    abi: [
      ...auditorAbi,
      ...marketAbi,
      ...upgradeableModularAccountAbi,
      {
        type: "function",
        inputs: [
          { name: "maturity", internalType: "uint256", type: "uint256" },
          { name: "collateral", internalType: "contract IMarket", type: "address" },
        ],
        name: "crossRepay",
        outputs: [],
        stateMutability: "nonpayable",
      },
    ],
    query: { enabled: enableSimulations && mode === "legacyCrossRepay" && !!selectedAsset.address && !!maturity },
  });

  const {
    mutate,
    isPending: isRepaying,
    isSuccess: isRepaySuccess,
    error: writeContractError,
  } = useWriteContract({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: assetQueryKey }).catch(reportError),
    },
  });

  const handlePayment = useCallback(() => {
    if (!repayMarket) return;
    setDisplayValues({
      amount: Number(withUSDC ? repayAssets : route?.fromAmount) / 10 ** repayMarket.decimals,
      usdAmount: Number(previewValueUSD) / 1e18,
    });
    switch (mode) {
      case "repay":
        if (!repayPropose) throw new Error("no repay simulation");
        mutate(repayPropose.request);
        break;
      case "legacyRepay":
        if (!legacyRepaySimulation) throw new Error("no legacy repay simulation");
        mutate(legacyRepaySimulation.request);
        break;
      case "crossRepay":
        if (!crossRepayPropose) throw new Error("no cross repay simulation");
        mutate(crossRepayPropose.request);
        break;
      case "legacyCrossRepay":
        if (!legacyCrossRepaySimulation) throw new Error("no legacy cross repay simulation");
        mutate(legacyCrossRepaySimulation.request);
        break;
    }
    setEnableSimulations(false);
  }, [
    crossRepayPropose,
    legacyCrossRepaySimulation,
    legacyRepaySimulation,
    mode,
    previewValueUSD,
    repayAssets,
    repayMarket,
    repayPropose,
    route?.fromAmount,
    withUSDC,
    mutate,
  ]);

  const {
    mutateAsync: repayWithExternalAsset,
    isPending: isExternalRepaying,
    isSuccess: isExternalRepaySuccess,
    error: externalRepayError,
  } = useMutation({
    async mutationFn() {
      if (!account) throw new Error("no account");
      if (!maturity) throw new Error("no maturity");
      if (!externalAsset) throw new Error("no external asset");
      if (!selectedAsset.address) throw new Error("no selected asset");
      if (!selectedAsset.external) throw new Error("not external asset");
      if (!route) throw new Error("no route");
      if (!route.fromAmount) throw new Error("no route from amount");
      if (!positionAssets) throw new Error("no position assets");
      if (!maxRepay) throw new Error("no max repay");
      setDisplayValues({
        amount: Number(route.fromAmount) / 10 ** externalAsset.decimals,
        usdAmount: (Number(externalAsset.priceUSD) * Number(route.fromAmount)) / 10 ** externalAsset.decimals,
      });
      const { id } = await mutateSendCalls({
        calls: [
          {
            to: selectedAsset.address,
            abi: erc20Abi,
            functionName: "approve",
            args: [swapperAddress, route.fromAmount],
          },
          { to: swapperAddress, data: route.data },
          {
            to: usdcAddress,
            abi: erc20Abi,
            functionName: "approve",
            args: [marketUSDCAddress, maxRepay],
          },
          {
            to: marketUSDCAddress,
            functionName: "repayAtMaturity",
            abi: marketAbi,
            args: [maturity, positionAssets, maxRepay, account],
          },
        ],
        capabilities: {
          paymasterService: {
            url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
            context: { policyId: alchemyGasPolicyId },
          },
        },
      });
      setEnableSimulations(false);
      const { status } = await waitForCallsStatus(exa, { id });
      if (status === "failure") throw new Error("failed to repay with external asset");
    },
    onError(error) {
      reportError(error);
    },
  });

  const simulationError = {
    repay: repayExecuteProposalError,
    crossRepay: crossRepayExecuteProposalError ?? routeError,
    legacyRepay: legacyRepaySimulationError,
    legacyCrossRepay: legacyCrossRepaySimulationError ?? routeError,
    external:
      routeError ??
      (route?.fromAmount && route.fromAmount > externalAssetAvailable ? new Error("insufficient funds") : undefined), // TODO simulate with [eth_simulateV1](https://viem.sh/docs/actions/public/simulateCalls)
    none: null,
  }[mode];
  const isSimulating = {
    repay: isSimulatingRepay,
    legacyRepay: isSimulatingLegacyRepay,
    crossRepay: isSimulatingCrossRepay,
    legacyCrossRepay: isSimulatingLegacyCrossRepay,
    external: false,
    none: false,
  }[mode];

  useEffect(() => {
    if (
      !simulationError ||
      !route?.tool ||
      !(simulationError instanceof ContractFunctionExecutionError) ||
      !(simulationError.cause instanceof ContractFunctionRevertedError) ||
      simulationError.cause.data?.errorName === "MarketFrozen"
    ) {
      return;
    }
    addDeniedExchange(route.tool);
  }, [addDeniedExchange, route?.tool, simulationError]);

  const isPending = mode === "external" ? isExternalRepaying : isRepaying;
  const isSuccess = mode === "external" ? isExternalRepaySuccess : isRepaySuccess;
  const writeError = mode === "external" ? externalRepayError : writeContractError;

  const handleAssetSelect = useCallback((address: Address, external: boolean) => {
    setManuallySelectedAsset({ address, external });
  }, []);

  const disabled =
    isSimulating || !!simulationError || (selectedAsset.external && !route) || repayAssets > maxRepayInput;
  const loading = isSimulating || isPending || (selectedAsset.external && isRoutePending);

  const symbol =
    repayMarket?.symbol.slice(3) === "WETH" ? "ETH" : (repayMarket?.symbol.slice(3) ?? externalAsset?.symbol);
  const dueDateFormatted = maturity
    ? new Date(Number(maturity) * 1000).toLocaleDateString(language, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";

  const handleButtonText = () => {
    if (repayAssets === 0n) return t("Enter amount");
    if (simulationError || repayAssets > maxRepayInput) return t("Cannot proceed");
    if (loading) return t("Please wait...");
    return t("Confirm payment");
  };

  if (!maturity) return;
  if (!isPending && !isSuccess && !writeError)
    return (
      <SafeView fullScreen backgroundColor="$backgroundMild" paddingBottom={0}>
        <View fullScreen gap="$s5" paddingTop="$s4_5">
          <View flexDirection="row" gap={10} justifyContent="space-around" alignItems="center">
            <View padded position="absolute" left={0}>
              <Pressable
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace("/(main)/(home)");
                  }
                }}
              >
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
            </View>
            <Text color="$uiNeutralPrimary" emphasized subHeadline textAlign="center">
              {t("Pay due {{date}}", { date: dueDateFormatted })}
            </Text>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flex: 1, justifyContent: "space-between" }}
          >
            <View padded>
              <YStack gap="$s4" paddingTop="$s5">
                <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                  <Text secondary footnote textAlign="left">
                    {t("Debt")}
                  </Text>
                  <XStack alignItems="center" gap="$s2">
                    <AssetLogo symbol="USDC" width={24} height={24} />
                    <Text primary title3 textAlign="right">
                      {(Number(positionValue) / 1e6).toLocaleString(language, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 6,
                      })}
                    </Text>
                  </XStack>
                </XStack>
                <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                  <Text secondary footnote textAlign="left">
                    {t("Enter amount")}
                  </Text>
                </XStack>

                {isProposalDelayLoading ? (
                  <Skeleton height={180} width="100%" />
                ) : (
                  <RepayAmountSelector
                    value={repayAssets}
                    onChange={setSelectedRepayAssets}
                    maxRepayInput={maxRepayInput}
                    totalPositionRepay={repayAssetsForFullDebt ?? 0n}
                    balancerBalance={balancerUSDCBalance}
                    positionValue={positionValue}
                  />
                )}
                {positionAssets ? (
                  <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                    <Text secondary footnote textAlign="left">
                      {t("Subtotal")}
                    </Text>
                    <XStack alignItems="center" gap="$s2_5">
                      <AssetLogo symbol="USDC" width={20} height={20} />
                      {isRouteFetching ? (
                        <Skeleton height={25} width={40} />
                      ) : (
                        <Text title3 maxFontSizeMultiplier={1} numberOfLines={1} textAlign="right">
                          {(Number(positionAssets) / 1e6).toLocaleString(language, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2,
                            useGrouping: false,
                          })}
                        </Text>
                      )}
                    </XStack>
                  </XStack>
                ) : null}
                {repayAssets ? (
                  <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                    {discountOrPenaltyPercentage >= 0 ? (
                      <Text secondary footnote textAlign="left">
                        {t("Early repay discount")}{" "}
                        <Text color="$uiSuccessSecondary" footnote textAlign="left">
                          {t("{{discount}} off", {
                            discount: Math.abs(discountOrPenaltyPercentage)
                              .toLocaleString(language, {
                                style: "percent",
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                              .replaceAll(/\s+/g, ""),
                          })}
                        </Text>
                      </Text>
                    ) : (
                      <Text secondary footnote textAlign="left">
                        {t("Late repay")}{" "}
                        <Text color="$uiErrorSecondary" footnote textAlign="left">
                          {t("Penalties {{percent}}", {
                            percent: Math.abs(discountOrPenaltyPercentage)
                              .toLocaleString(language, {
                                style: "percent",
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                              .replaceAll(/\s+/g, ""),
                          })}
                        </Text>
                      </Text>
                    )}
                    <XStack alignItems="center" gap="$s2">
                      <AssetLogo symbol="USDC" width={20} height={20} />
                      <Text
                        primary
                        title3
                        textAlign="right"
                        color={
                          discountOrPenaltyPercentage >= 0
                            ? "$interactiveOnBaseSuccessSoft"
                            : "$interactiveOnBaseErrorSoft"
                        }
                      >
                        {Math.abs(Number(positionAssets - repayAssets) / 1e6).toLocaleString(language, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                    </XStack>
                  </XStack>
                ) : null}
                {repayAssets ? (
                  <>
                    <Separator height={1} borderColor="$borderNeutralSoft" />
                    <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                      <Text secondary footnote textAlign="left">
                        {t("You will pay")}
                      </Text>
                      <YStack alignItems="flex-end">
                        <XStack alignItems="center" gap="$s2_5">
                          <AssetLogo symbol="USDC" width={20} height={20} />
                          {isRouteFetching ? (
                            <Skeleton height={25} width={40} />
                          ) : (
                            <Text
                              title3
                              maxFontSizeMultiplier={1}
                              numberOfLines={1}
                              textAlign="right"
                              color={discountOrPenaltyPercentage >= 0 ? "$uiSuccessSecondary" : "$uiErrorSecondary"}
                            >
                              {(Number(repayAssets) / 1e6).toLocaleString(language, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                                useGrouping: false,
                              })}
                            </Text>
                          )}
                        </XStack>
                        {route && (
                          <XStack gap="$s3" alignItems="center" justifyContent="flex-end">
                            <Text secondary footnote maxFontSizeMultiplier={1} numberOfLines={1} textAlign="right">
                              {`${(
                                Number(route.fromAmount) /
                                10 ** (externalAsset ? externalAsset.decimals : (repayMarket?.decimals ?? 18))
                              ).toLocaleString(language, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 8,
                                useGrouping: false,
                              })} ${symbol}`}
                            </Text>
                          </XStack>
                        )}
                      </YStack>
                    </XStack>
                  </>
                ) : null}
              </YStack>
            </View>
          </ScrollView>
          <View
            padded
            flexShrink={1}
            backgroundColor="$backgroundSoft"
            borderRadius="$r4"
            borderBottomLeftRadius={0}
            borderBottomRightRadius={0}
          >
            <YStack gap="$s4" paddingBottom={insets.bottom}>
              <XStack
                justifyContent="space-between"
                gap="$s3"
                alignItems="center"
                cursor="pointer"
                onPress={() => {
                  setAssetSelectionOpen(true);
                }}
              >
                <Text secondary callout textAlign="left">
                  {t("Pay with")}
                </Text>
                <XStack gap="$s3" alignItems="center">
                  <AssetLogo height={16} symbol={symbol} width={16} />
                  <Text primary emphasized headline textAlign="right">
                    {symbol}
                  </Text>
                  <ChevronRight size={24} color="$interactiveBaseBrandDefault" />
                </XStack>
              </XStack>
              <XStack justifyContent="space-between" gap="$s3">
                <Text secondary callout textAlign="left">
                  {t("Portfolio balance")}
                </Text>
                <YStack gap="$s2">
                  <XStack alignItems="center" gap="$s2">
                    <AssetLogo height={16} symbol={symbol} width={16} />
                    {isFetchingAsset ? (
                      <Skeleton height={23} width={100} />
                    ) : (
                      <Text primary emphasized headline textAlign="right">
                        {(repayMarket
                          ? Number(repayMarketAvailable) / 10 ** repayMarket.decimals
                          : Number(externalAssetAvailable) / 10 ** (externalAsset?.decimals ?? 18)
                        ).toLocaleString(language, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 8,
                          useGrouping: false,
                        })}
                      </Text>
                    )}
                  </XStack>
                </YStack>
              </XStack>
              <XStack
                justifyContent="space-between"
                gap="$s3"
                opacity={selectedAsset.address === exaUSDC?.market ? 0 : 1}
                pointerEvents={selectedAsset.address === exaUSDC?.market ? "none" : "auto"}
              >
                <Text secondary callout textAlign="left">
                  {t("Available for repayment")}
                </Text>
                <YStack gap="$s2">
                  <XStack alignItems="center" gap="$s2">
                    <AssetLogo symbol="USDC" width={16} height={16} />
                    {isRouteFromFetching ? (
                      <Skeleton height={23} width={50} />
                    ) : (
                      <Text emphasized headline primary textAlign="right">
                        {(Number(availableForRepayment) / 1e6).toLocaleString(language, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                    )}
                  </XStack>
                </YStack>
              </XStack>

              <Button
                primary
                loading={loading && positionAssets > 0n}
                disabled={disabled}
                onPress={selectedAsset.external ? () => repayWithExternalAsset() : handlePayment}
              >
                <Button.Text>{handleButtonText()}</Button.Text>
                <Button.Icon>
                  <Coins />
                </Button.Icon>
              </Button>
            </YStack>
          </View>
          <AssetSelectionSheet
            onAssetSelected={handleAssetSelect}
            open={assetSelectionOpen}
            onClose={() => {
              setAssetSelectionOpen(false);
            }}
          />
        </View>
      </SafeView>
    );
  if (isPending && repayAssets)
    return (
      <Pending
        maturity={maturity}
        amount={displayValues.amount}
        repayAssets={repayAssets}
        currency={symbol}
        selectedAsset={selectedAsset.address}
        onClose={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace("/(main)/(home)");
          }
        }}
      />
    );
  if (isSuccess && repayAssets)
    return (
      <Success
        maturity={maturity}
        amount={displayValues.amount}
        repayAssets={repayAssets}
        currency={symbol}
        selectedAsset={selectedAsset.address}
        onClose={() => {
          router.dismissTo("/activity");
        }}
      />
    );
  if (writeError && repayAssets)
    return (
      <Failure
        maturity={maturity}
        amount={displayValues.amount}
        repayAssets={repayAssets}
        currency={symbol}
        selectedAsset={selectedAsset.address}
        onClose={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace("/(main)/(home)");
          }
        }}
      />
    );
}

const SLIPPAGE_DIVISOR = 1000n; // 10 bps
const pad = (value: bigint, divisor = 1_000_000n) => value + (value / divisor || 1n);
