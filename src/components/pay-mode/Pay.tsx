import ProposalType from "@exactly/common/ProposalType";
import {
  balancerVaultAddress,
  exaPluginAddress,
  marketUSDCAddress,
  swapperAddress,
  usdcAddress,
  integrationPreviewerAddress,
} from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { divWad, fixedRepayAssets, fixedRepayPosition, min, mulWad, WAD } from "@exactly/lib";
import { ArrowLeft, ChevronRight, Coins } from "@tamagui/lucide-icons";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useNavigation, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Separator, XStack, YStack } from "tamagui";
import { digits, parse, pipe, safeParse, string, transform, nonEmpty } from "valibot";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  erc20Abi,
  maxUint256,
  zeroAddress,
} from "viem";
import { useBytecode, useReadContract, useSimulateContract, useWriteContract } from "wagmi";

import AssetSelectionSheet from "./AssetSelectionSheet";
import RepayAmountSelector from "./RepayAmountSelector";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import SafeView from "../../components/shared/SafeView";
import Button from "../../components/shared/StyledButton";
import Text from "../../components/shared/Text";
import View from "../../components/shared/View";
import {
  auditorAbi,
  integrationPreviewerAbi,
  marketAbi,
  upgradeableModularAccountAbi,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "../../generated/contracts";
import { accountClient } from "../../utils/alchemyConnector";
import assetLogos from "../../utils/assetLogos";
import { getRoute, getRouteFrom } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAccountAssets from "../../utils/useAccountAssets";
import useAsset from "../../utils/useAsset";
import useSimulateProposal from "../../utils/useSimulateProposal";
import AssetLogo from "../shared/AssetLogo";
import Failure from "../shared/Failure";
import Pending from "../shared/Pending";
import Skeleton from "../shared/Skeleton";
import Success from "../shared/Success";

export default function Pay() {
  const insets = useSafeAreaInsets();
  const { address: account } = useAccount();
  const navigation = useNavigation<AppNavigationProperties>();
  const { t } = useTranslation();
  const { accountAssets } = useAccountAssets({ sortBy: "usdcFirst" });
  const { market: exaUSDC } = useAsset(marketUSDCAddress);
  const [enableSimulations, setEnableSimulations] = useState(true);
  const [assetSelectionOpen, setAssetSelectionOpen] = useState(false);
  const [denyExchanges, setDenyExchanges] = useState<Record<string, boolean>>({});
  const [selectedAsset, setSelectedAsset] = useState<{ address?: Address; external: boolean }>({ external: true });
  const [positionAssets, setPositionAssets] = useState(0n);
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
  const { data: bytecode } = useBytecode({ address: account ?? zeroAddress, query: { enabled: !!account } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: account ?? zeroAddress,
    query: { enabled: !!account && !!bytecode },
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
    args: [account ?? zeroAddress, marketUSDCAddress, maturity ?? 0n],
    query: { enabled: !!account && !!bytecode && !!maturity },
  });

  const repayAssets = fixedRepaySnapshot
    ? fixedRepayAssets(fixedRepaySnapshot, Number(maturity ?? 0n), positionAssets)
    : undefined;

  const borrow = exaUSDC?.fixedBorrowPositions.find((b) => b.maturity === maturity);
  const previewValueUSD =
    borrow && exaUSDC ? (borrow.previewValue * exaUSDC.usdPrice) / 10n ** BigInt(exaUSDC.decimals) : 0n;

  const positionValue = borrow ? borrow.position.principal + borrow.position.fee : 0n;

  const discountOrPenalty = repayAssets ? divWad(repayAssets, positionAssets) : 0n;
  const discountRatio = WAD - discountOrPenalty;
  const scaledRatioAsBigInt = (discountRatio * 10n ** 8n) / WAD;
  const discountOrPenaltyPercentage = Number(scaledRatioAsBigInt) / Number(10n ** 8n);

  const positions = markets
    ?.map((market) => ({
      ...market,
      usdValue: (market.floatingDepositAssets * market.usdPrice) / BigInt(10 ** market.decimals),
    }))
    .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0n);

  const repayMarket = positions?.find((p) => p.market === selectedAsset.address);
  const repayMarketAvailable =
    repayMarket && selectedAsset.address && !selectedAsset.external ? repayMarket.floatingDepositAssets : 0n;

  const { data: balancerUSDCBalance = maxUint256 } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [balancerVaultAddress ?? zeroAddress],
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
  const maxPositionAssets = useMemo(() => {
    const availableUSDC = repayMarket?.market === exaUSDC?.market ? repayMarketAvailable : availableForRepayment;

    return balancerUSDCBalance && fixedRepaySnapshot && maturity && availableUSDC
      ? min(
          fixedRepayPosition(
            fixedRepaySnapshot,
            Number(maturity),
            divWad(min(balancerUSDCBalance, availableUSDC), slippage),
          ),
          positionValue,
        )
      : 0n;
  }, [
    repayMarket?.market,
    exaUSDC?.market,
    repayMarketAvailable,
    availableForRepayment,
    balancerUSDCBalance,
    fixedRepaySnapshot,
    maturity,
    positionValue,
  ]);

  const maxRepay = borrow ? (repayAssets ? mulWad(repayAssets, slippage) : undefined) : 0n;
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

  const maxAmountIn = route?.fromAmount ? (route.fromAmount * slippage) / WAD + 69n : undefined; // HACK try to avoid ZERO_SHARES on dust deposit

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
    args: [maturity ?? 0n, selectedAsset.address ?? zeroAddress],
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
    query: { enabled: enableSimulations && mode === "legacyCrossRepay" },
  });

  const {
    writeContract,
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
        writeContract(repayPropose.request);
        break;
      case "legacyRepay":
        if (!legacyRepaySimulation) throw new Error("no legacy repay simulation");
        writeContract(legacyRepaySimulation.request);
        break;
      case "crossRepay":
        if (!crossRepayPropose) throw new Error("no cross repay simulation");
        writeContract(crossRepayPropose.request);
        break;
      case "legacyCrossRepay":
        if (!legacyCrossRepaySimulation) throw new Error("no legacy cross repay simulation");
        writeContract(legacyCrossRepaySimulation.request);
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
    writeContract,
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
      if (!accountClient) throw new Error("no account client");
      if (!externalAsset) throw new Error("no external asset");
      if (!selectedAsset.external) throw new Error("not external asset");
      if (!route) throw new Error("no route");
      if (!route.fromAmount) throw new Error("no route from amount");
      if (!positionAssets) throw new Error("no position assets");
      if (!maxRepay) throw new Error("no max repay");
      setDisplayValues({
        amount: Number(route.fromAmount) / 10 ** externalAsset.decimals,
        usdAmount: (Number(externalAsset.priceUSD) * Number(route.fromAmount)) / 10 ** externalAsset.decimals,
      });
      const uo = await accountClient.sendUserOperation({
        uo: [
          {
            target: selectedAsset.address ?? zeroAddress,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [swapperAddress, route.fromAmount],
            }),
          },
          { target: swapperAddress, data: route.data },
          {
            target: usdcAddress,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [marketUSDCAddress, maxRepay],
            }),
          },
          {
            target: marketUSDCAddress,
            data: encodeFunctionData({
              functionName: "repayAtMaturity",
              abi: marketAbi,
              args: [maturity, positionAssets, maxRepay, account],
            }),
          },
        ],
      });
      setEnableSimulations(false);
      return await accountClient.waitForUserOperationTransaction(uo);
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
    setDenyExchanges((state) => ({ ...state, [route.tool]: true }));
  }, [route?.tool, simulationError]);

  const isPending = mode === "external" ? isExternalRepaying : isRepaying;
  const isSuccess = mode === "external" ? isExternalRepaySuccess : isRepaySuccess;
  const writeError = mode === "external" ? externalRepayError : writeContractError;

  if (!selectedAsset.address && accountAssets[0]) {
    const { type } = accountAssets[0];
    setSelectedAsset({
      address: type === "external" ? parse(Address, accountAssets[0].address) : parse(Address, accountAssets[0].market),
      external: type === "external",
    });
  }

  const handleAssetSelect = useCallback((address: Address, external: boolean) => {
    setSelectedAsset({ address, external });
  }, []);

  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  const disabled =
    isSimulating || !!simulationError || (selectedAsset.external && !route) || positionAssets > maxPositionAssets;
  const loading = isSimulating || isPending || (selectedAsset.external && isRoutePending);

  const symbol =
    repayMarket?.symbol.slice(3) === "WETH" ? "ETH" : (repayMarket?.symbol.slice(3) ?? externalAsset?.symbol);
  const dueDateFormatted = maturity ? format(new Date(Number(maturity) * 1000), "MMM dd, yyyy") : "";

  const handleButtonText = () => {
    if (positionAssets === 0n) return t("Enter amount", { defaultValue: "Enter amount" });
    if (simulationError || positionAssets > maxPositionAssets)
      return t("Cannot proceed", { defaultValue: "Cannot proceed" });
    if (loading) return t("Please wait...", { defaultValue: "Please wait..." });
    return t("Confirm payment", { defaultValue: "Confirm payment" });
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
                  if (navigation.canGoBack()) {
                    navigation.goBack();
                  } else {
                    navigation.replace("(main)");
                  }
                }}
              >
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
            </View>
            <Text color="$uiNeutralPrimary" emphasized subHeadline textAlign="center">
              {t("Pay due {{date}}", {
                date: dueDateFormatted,
                defaultValue: "Pay due {{date}}",
              })}
            </Text>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flex: 1, justifyContent: "space-between" }} // eslint-disable-line react-native/no-inline-styles
          >
            <View padded>
              <YStack gap="$s4" paddingTop="$s5">
                <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                  <Text secondary footnote textAlign="left">
                    {t("Debt", { defaultValue: "Debt" })}
                  </Text>
                  <XStack alignItems="center" gap="$s2">
                    <AssetLogo source={{ uri: assetLogos.USDC }} width={24} height={24} />
                    <Text primary title3 textAlign="right">
                      {(Number(positionValue) / 1e6).toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 6,
                      })}
                    </Text>
                  </XStack>
                </XStack>
                <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                  <Text secondary footnote textAlign="left">
                    {t("Enter amount:", { defaultValue: "Enter amount:" })}
                  </Text>
                </XStack>

                <RepayAmountSelector
                  onChange={setPositionAssets}
                  maxPositionAssets={maxPositionAssets}
                  balancerBalance={balancerUSDCBalance}
                  positionValue={positionValue}
                  repayMarket={repayMarket?.market}
                />
                {positionAssets && (
                  <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                    <Text secondary footnote textAlign="left">
                      {t("Subtotal", { defaultValue: "Subtotal" })}
                    </Text>
                    <XStack alignItems="center" gap="$s2_5">
                      <AssetLogo source={{ uri: assetLogos.USDC }} width={20} height={20} />
                      {isRouteFetching ? (
                        <Skeleton height={25} width={40} />
                      ) : (
                        <Text title3 maxFontSizeMultiplier={1} numberOfLines={1} textAlign="right">
                          {(Number(positionAssets) / 1e6).toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2,
                            useGrouping: false,
                          })}
                        </Text>
                      )}
                    </XStack>
                  </XStack>
                )}
                {repayAssets && (
                  <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                    {discountOrPenaltyPercentage >= 0 ? (
                      <Text secondary footnote textAlign="left">
                        {t("Early repay discount", { defaultValue: "Early repay discount" })}{" "}
                        <Text color="$uiSuccessSecondary" footnote textAlign="left">
                          {t("{{discount}} off", {
                            discount: Math.abs(discountOrPenaltyPercentage)
                              .toLocaleString(undefined, {
                                style: "percent",
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                              .replaceAll(/\s+/g, ""),
                            defaultValue: "{{discount}} off",
                          })}
                        </Text>
                      </Text>
                    ) : (
                      <Text secondary footnote textAlign="left">
                        {t("Late repay", { defaultValue: "Late repay" })}{" "}
                        <Text color="$uiErrorSecondary" footnote textAlign="left">
                          {t("Penalties {{percent}}", {
                            percent: Math.abs(discountOrPenaltyPercentage)
                              .toLocaleString(undefined, {
                                style: "percent",
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                              .replaceAll(/\s+/g, ""),
                            defaultValue: "Penalties {{percent}}",
                          })}
                        </Text>
                      </Text>
                    )}
                    <XStack alignItems="center" gap="$s2">
                      <AssetLogo source={{ uri: assetLogos.USDC }} width={20} height={20} />
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
                        {Math.abs(Number(positionAssets - repayAssets) / 1e6).toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                    </XStack>
                  </XStack>
                )}
                {repayAssets && (
                  <>
                    <Separator height={1} borderColor="$borderNeutralSoft" />
                    <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                      <Text secondary footnote textAlign="left">
                        {t("You will pay", { defaultValue: "You will pay" })}
                      </Text>
                      <YStack alignItems="flex-end">
                        <XStack alignItems="center" gap="$s2_5">
                          <AssetLogo source={{ uri: assetLogos.USDC }} width={20} height={20} />
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
                              {(Number(repayAssets) / 1e6).toLocaleString(undefined, {
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
                              ).toLocaleString(undefined, {
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
                )}
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
              <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                <Text secondary callout textAlign="left">
                  {t("Pay with", { defaultValue: "Pay with" })}
                </Text>
                <YStack>
                  <XStack
                    gap="$s3"
                    alignItems="center"
                    justifyContent="flex-end"
                    cursor="pointer"
                    onPress={() => {
                      setAssetSelectionOpen(true);
                    }}
                  >
                    {repayMarket && (
                      <AssetLogo
                        source={{ uri: assetLogos[symbol as keyof typeof assetLogos] }}
                        width={16}
                        height={16}
                      />
                    )}
                    {selectedAsset.external && externalAsset && (
                      <Image source={{ uri: externalAsset.logoURI }} width={16} height={16} borderRadius={50} />
                    )}
                    <Text primary emphasized headline textAlign="right">
                      {symbol}
                    </Text>
                    <ChevronRight size={24} color="$interactiveBaseBrandDefault" />
                  </XStack>
                </YStack>
              </XStack>
              <XStack justifyContent="space-between" gap="$s3">
                <Text secondary callout textAlign="left">
                  {t("Portfolio balance", { defaultValue: "Portfolio balance" })}
                </Text>
                <YStack gap="$s2">
                  <XStack alignItems="center" gap="$s2">
                    {repayMarket && (
                      <AssetLogo
                        source={{ uri: assetLogos[symbol as keyof typeof assetLogos] }}
                        width={16}
                        height={16}
                      />
                    )}
                    {selectedAsset.external && externalAsset && (
                      <Image source={{ uri: externalAsset.logoURI }} width={16} height={16} borderRadius={50} />
                    )}
                    {isFetchingAsset ? (
                      <Skeleton height={23} width={100} />
                    ) : (
                      <Text primary emphasized headline textAlign="right">
                        {(repayMarket
                          ? Number(repayMarketAvailable) / 10 ** repayMarket.decimals
                          : Number(externalAssetAvailable) / 10 ** (externalAsset?.decimals ?? 18)
                        ).toLocaleString(undefined, {
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
                  {t("Available for repayment", { defaultValue: "Available for repayment" })}
                </Text>
                <YStack gap="$s2">
                  <XStack alignItems="center" gap="$s2">
                    <AssetLogo source={{ uri: assetLogos.USDC }} width={16} height={16} />
                    {isRouteFromFetching ? (
                      <Skeleton height={23} width={50} />
                    ) : (
                      <Text emphasized headline primary textAlign="right">
                        {(Number(availableForRepayment) / 1e6).toLocaleString(undefined, {
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
            positions={positions}
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
          if (navigation.canGoBack()) {
            navigation.goBack();
          } else {
            navigation.replace("(main)");
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
          navigation.replace(isLatestPlugin ? "pending-proposals/index" : "(main)");
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
          if (navigation.canGoBack()) {
            navigation.goBack();
          } else {
            navigation.replace("(main)");
          }
        }}
      />
    );
}

const slippage = (WAD * 1001n) / 1000n;
