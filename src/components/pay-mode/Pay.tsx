import ProposalType from "@exactly/common/ProposalType";
import { exaPluginAddress, marketUSDCAddress, swapperAddress, usdcAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { WAD, withdrawLimit } from "@exactly/lib";
import { ArrowLeft, ChevronRight, Coins } from "@tamagui/lucide-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Separator, XStack, YStack } from "tamagui";
import { digits, parse, pipe, safeParse, string, transform } from "valibot";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  erc20Abi,
  parseUnits,
  zeroAddress,
} from "viem";
import { useAccount, useBytecode, useSimulateContract, useWriteContract } from "wagmi";

import AssetSelectionSheet from "./AssetSelectionSheet";
import SafeView from "../../components/shared/SafeView";
import Button from "../../components/shared/StyledButton";
import Text from "../../components/shared/Text";
import View from "../../components/shared/View";
import {
  auditorAbi,
  marketAbi,
  upgradeableModularAccountAbi,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "../../generated/contracts";
import { accountClient } from "../../utils/alchemyConnector";
import assetLogos from "../../utils/assetLogos";
import { getRoute } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
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
  const { accountAssets } = useAccountAssets({ sortBy: "usdcFirst" });
  const { market: exaUSDC } = useAsset(marketUSDCAddress);
  const [enableSimulations, setEnableSimulations] = useState(true);
  const [assetSelectionOpen, setAssetSelectionOpen] = useState(false);
  const [denyExchanges, setDenyExchanges] = useState<Record<string, boolean>>({});
  const [selectedAsset, setSelectedAsset] = useState<{ address?: Address; external: boolean }>({ external: true });
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
      pipe(string("no maturity"), digits("bad maturity"), transform(BigInt as (input: string) => bigint)),
      maturityQuery,
    );
    if (success) return output;
  }, [maturityQuery]);

  const borrow = exaUSDC?.fixedBorrowPositions.find((b) => b.maturity === maturity);
  const previewValue =
    borrow && exaUSDC ? (borrow.previewValue * exaUSDC.usdPrice) / 10n ** BigInt(exaUSDC.decimals) : 0n;
  const positionValue =
    borrow && exaUSDC
      ? ((borrow.position.principal + borrow.position.fee) * exaUSDC.usdPrice) / 10n ** BigInt(exaUSDC.decimals)
      : 0n;
  const discount = positionValue === 0n ? 0 : Number(WAD - (previewValue * WAD) / positionValue) / 1e18;
  const positions = markets
    ?.map((market) => ({
      ...market,
      usdValue: (market.floatingDepositAssets * market.usdPrice) / BigInt(10 ** market.decimals),
    }))
    .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0n);

  const repayMarket = positions?.find((p) => p.market === selectedAsset.address);
  const repayMarketAvailable =
    markets && selectedAsset.address && !selectedAsset.external ? withdrawLimit(markets, selectedAsset.address) : 0n;

  const maxRepay = borrow ? (borrow.previewValue * slippage) / WAD : 0n;

  const {
    data: route,
    error: routeError,
    isPending: isRoutePending,
  } = useQuery({
    queryKey: ["lifi", "route", mode, account, selectedAsset.address, repayMarket?.asset, maxRepay],
    queryFn: () => {
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
      enableSimulations && !!maxRepay && (mode === "crossRepay" || mode === "legacyCrossRepay" || mode === "external"),
    refetchInterval: 20_000,
  });

  const positionAssets = borrow ? borrow.position.principal + borrow.position.fee : 0n;
  const maxAmountIn = route ? (route.fromAmount * slippage) / WAD + 69n : undefined; // HACK try to avoid ZERO_SHARES on dust deposit

  const {
    propose: { data: repayPropose },
    executeProposal: { error: repayExecuteProposalError, isPending: isSimulatingRepay },
  } = useSimulateProposal({
    account,
    amount: maxRepay,
    market: selectedAsset.address,
    enabled: enableSimulations && mode === "repay",
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
    enabled: enableSimulations && mode === "crossRepay",
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
      amount: Number(withUSDC ? positionAssets : route?.fromAmount) / 10 ** repayMarket.decimals,
      usdAmount: Number(previewValue) / 1e18,
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
    positionAssets,
    previewValue,
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
              args: [BigInt(maturity), positionAssets, maxRepay, account],
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
      routeError ?? (route && route.fromAmount > externalAssetAvailable ? new Error("insufficient funds") : undefined), // TODO simulate with [eth_simulateV1](https://viem.sh/docs/actions/public/simulateCalls)
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
      !route?.exchange ||
      !(simulationError instanceof ContractFunctionExecutionError) ||
      !(simulationError.cause instanceof ContractFunctionRevertedError) ||
      simulationError.cause.data?.errorName === "MarketFrozen"
    ) {
      return;
    }
    setDenyExchanges((state) => ({ ...state, [route.exchange]: true }));
  }, [route?.exchange, simulationError]);

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
  const disabled = isSimulating || !!simulationError || (selectedAsset.external && !route);
  const loading = isSimulating || isPending || (selectedAsset.external && isRoutePending);
  if (!maturity) return;
  if (!isPending && !isSuccess && !writeError)
    return (
      <SafeView fullScreen backgroundColor="$backgroundMild" paddingBottom={0}>
        <View fullScreen gap="$s5" paddingTop="$s4_5">
          <View flexDirection="row" gap={10} justifyContent="space-around" alignItems="center">
            <View padded position="absolute" left={0}>
              <Pressable
                onPress={() => {
                  router.back();
                }}
              >
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
            </View>
            <Text color="$uiNeutralPrimary" emphasized subHeadline>
              <Text primary textAlign="center" emphasized subHeadline>
                Pay due {format(new Date(Number(maturity) * 1000), "MMM dd, yyyy")}
              </Text>
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
                    Purchases
                  </Text>
                  <Text primary title3 textAlign="right">
                    {(Number(positionValue) / 1e18).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      currencyDisplay: "narrowSymbol",
                    })}
                  </Text>
                </XStack>
                <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                  {discount >= 0 ? (
                    <Text secondary footnote textAlign="left">
                      Early repay&nbsp;
                      <Text color="$uiSuccessSecondary" footnote textAlign="left">
                        {discount
                          .toLocaleString(undefined, {
                            style: "percent",
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                          .replaceAll(/\s+/g, "")}
                        &nbsp;OFF
                      </Text>
                    </Text>
                  ) : (
                    <Text secondary footnote textAlign="left">
                      Late repay&nbsp;
                      <Text color="$uiErrorSecondary" footnote textAlign="left">
                        {(-discount)
                          .toLocaleString(undefined, {
                            style: "percent",
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                          .replaceAll(/\s+/g, "")}
                        &nbsp;penalty
                      </Text>
                    </Text>
                  )}
                  <Text
                    primary
                    title3
                    textAlign="right"
                    color={discount >= 0 ? "$interactiveOnBaseSuccessSoft" : "$interactiveOnBaseErrorSoft"}
                  >
                    {Number(previewValue - positionValue) / 1e18 > 0.01
                      ? Math.abs(Number(previewValue - positionValue) / 1e18).toLocaleString(undefined, {
                          style: "currency",
                          currency: "USD",
                          currencyDisplay: "narrowSymbol",
                        })
                      : `< ${(0.01).toLocaleString(undefined, {
                          style: "currency",
                          currency: "USD",
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`}
                  </Text>
                </XStack>
                <Separator height={1} borderColor="$borderNeutralSoft" paddingVertical="$s2" />
                <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                  <Text secondary footnote textAlign="left">
                    You&apos;ll pay
                  </Text>
                  <Text title textAlign="right" color={discount >= 0 ? "$uiSuccessSecondary" : "$uiErrorSecondary"}>
                    {(Number(previewValue) / 1e18).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      currencyDisplay: "narrowSymbol",
                    })}
                  </Text>
                </XStack>
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
                  Pay with
                </Text>
                <YStack>
                  <XStack
                    gap="$s3"
                    alignItems="center"
                    justifyContent="flex-end"
                    onPress={() => {
                      setAssetSelectionOpen(true);
                    }}
                  >
                    {repayMarket && (
                      <AssetLogo
                        uri={
                          assetLogos[
                            repayMarket.symbol.slice(3) === "WETH"
                              ? "ETH"
                              : (repayMarket.symbol.slice(3) as keyof typeof assetLogos)
                          ]
                        }
                        width={16}
                        height={16}
                      />
                    )}
                    {selectedAsset.external && externalAsset && (
                      <Image source={{ uri: externalAsset.logoURI }} width={16} height={16} borderRadius={50} />
                    )}
                    <Text primary emphasized headline textAlign="right">
                      {repayMarket?.symbol.slice(3) === "WETH"
                        ? "ETH"
                        : (repayMarket?.symbol.slice(3) ?? externalAsset?.symbol)}
                    </Text>
                    <ChevronRight size={24} color="$interactiveBaseBrandDefault" />
                  </XStack>
                </YStack>
              </XStack>
              <XStack justifyContent="space-between" gap="$s3">
                <Text secondary callout textAlign="left">
                  Available
                </Text>
                <YStack gap="$s2">
                  {isFetchingAsset ? (
                    <>
                      <Skeleton height={20} width={100} />
                      <Skeleton height={20} width={100} />
                    </>
                  ) : (
                    <>
                      {repayMarket && (
                        <>
                          <Text emphasized headline primary textAlign="right">
                            {(Number(repayMarket.usdValue) / 1e18).toLocaleString(undefined, {
                              style: "currency",
                              currency: "USD",
                              currencyDisplay: "narrowSymbol",
                            })}
                          </Text>
                          <Text secondary footnote textAlign="right">
                            {`${(Number(repayMarketAvailable) / 10 ** repayMarket.decimals).toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: Math.min(
                                8,
                                Math.max(
                                  0,
                                  repayMarket.decimals -
                                    Math.ceil(Math.log10(Math.max(1, Number(repayMarket.usdValue) / 1e18))),
                                ),
                              ),
                              useGrouping: false,
                            })} ${repayMarket.symbol.slice(3) === "WETH" ? "ETH" : repayMarket.symbol.slice(3)}`}
                          </Text>
                        </>
                      )}
                      {selectedAsset.external && externalAsset && (
                        <>
                          <Text emphasized headline primary textAlign="right">
                            {Number(
                              (Number(externalAsset.priceUSD) * Number(externalAssetAvailable)) /
                                10 ** externalAsset.decimals,
                            ).toLocaleString(undefined, {
                              style: "currency",
                              currency: "USD",
                              currencyDisplay: "narrowSymbol",
                            })}
                          </Text>
                          <Text secondary footnote textAlign="right">
                            {`${(Number(externalAssetAvailable) / 10 ** externalAsset.decimals).toLocaleString(
                              undefined,
                              {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: Math.min(
                                  8,
                                  Math.max(
                                    0,
                                    externalAsset.decimals -
                                      Math.ceil(
                                        Math.log10(Math.max(1, Number(parseUnits(externalAsset.priceUSD, 18)) / 1e18)),
                                      ),
                                  ),
                                ),
                                useGrouping: false,
                              },
                            )} ${externalAsset.symbol}`}
                          </Text>
                        </>
                      )}
                    </>
                  )}
                </YStack>
              </XStack>
              <Button
                primary
                loading={loading}
                disabled={disabled}
                onPress={selectedAsset.external ? () => repayWithExternalAsset() : handlePayment}
              >
                <Button.Text>
                  {simulationError ? "Cannot proceed" : loading ? "Please wait..." : "Confirm payment"}
                </Button.Text>
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
  if (isPending)
    return (
      <Pending
        maturity={maturity}
        amount={displayValues.amount}
        usdAmount={displayValues.usdAmount}
        currency={repayMarket?.assetSymbol ?? externalAsset?.symbol}
        selectedAsset={selectedAsset.address}
      />
    );
  if (isSuccess)
    return (
      <Success
        maturity={maturity}
        amount={displayValues.amount}
        usdAmount={displayValues.usdAmount}
        currency={repayMarket?.assetSymbol ?? externalAsset?.symbol}
        selectedAsset={selectedAsset.address}
        onClose={() => {
          router.replace(isLatestPlugin ? "/(app)/pending-proposals" : "/pay-mode");
        }}
      />
    );
  if (writeError)
    return (
      <Failure
        maturity={maturity}
        amount={displayValues.amount}
        usdAmount={displayValues.usdAmount}
        currency={repayMarket?.assetSymbol ?? externalAsset?.symbol}
        selectedAsset={selectedAsset.address}
        onClose={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace("/(app)/(home)");
          }
        }}
      />
    );
}

const slippage = (WAD * 1001n) / 1000n;
