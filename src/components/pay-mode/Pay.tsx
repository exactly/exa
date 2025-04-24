import ProposalType from "@exactly/common/ProposalType";
import fixedRate from "@exactly/common/fixedRate";
import {
  exaPluginAbi,
  exaPluginAddress,
  marketUSDCAddress,
  upgradeableModularAccountAbi,
  usdcAddress,
} from "@exactly/common/generated/chain";
import { Address, Hex } from "@exactly/common/validation";
import { WAD, withdrawLimit } from "@exactly/lib";
import { ArrowLeft, ChevronRight, Coins } from "@tamagui/lucide-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { router, useLocalSearchParams } from "expo-router";
import { Skeleton } from "moti/skeleton";
import React, { useCallback, useState } from "react";
import { Pressable, Image, Appearance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Separator, Spinner, XStack, YStack } from "tamagui";
import { nonEmpty, parse, pipe, safeParse, string } from "valibot";
import { encodeFunctionData, erc20Abi, parseUnits, zeroAddress, encodeAbiParameters } from "viem";
import { useAccount, useBytecode, useSimulateContract, useWriteContract } from "wagmi";

import AssetSelectionSheet from "./AssetSelectionSheet";
import Failure from "./Failure";
import Pending from "./Pending";
import Success from "./Success";
import Button from "../../components/shared/Button";
import SafeView from "../../components/shared/SafeView";
import Text from "../../components/shared/Text";
import View from "../../components/shared/View";
import { auditorAbi, marketAbi, useReadUpgradeableModularAccountGetInstalledPlugins } from "../../generated/contracts";
import { accountClient } from "../../utils/alchemyConnector";
import assetLogos from "../../utils/assetLogos";
import { getRoute } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccountAssets from "../../utils/useAccountAssets";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";

export default function Pay() {
  const insets = useSafeAreaInsets();
  const { address: account } = useAccount();
  const { accountAssets } = useAccountAssets();
  const { market: exaUSDC } = useAsset(marketUSDCAddress);
  const [assetSelectionOpen, setAssetSelectionOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<{ address: Address; isExternalAsset: boolean }>({
    address: parse(Address, zeroAddress),
    isExternalAsset: true,
  });
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
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;

  const { success, output: maturity } = safeParse(
    pipe(string(), nonEmpty("no maturity")),
    useLocalSearchParams().maturity,
  );

  const handleAssetSelect = (address: Address, isExternalAsset: boolean) => {
    setSelectedAsset({ address, isExternalAsset });
  };

  const {
    writeContract: repay,
    isPending: isRepaying,
    isSuccess: isRepaySuccess,
    error: repayError,
  } = useWriteContract({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: assetQueryKey }).catch(reportError);
      },
    },
  });
  const {
    writeContract: crossRepay,
    isPending: isCrossRepaying,
    isSuccess: isCrossRepaySuccess,
    error: crossRepayError,
  } = useWriteContract({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: assetQueryKey }).catch(reportError);
      },
    },
  });

  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const isUSDCSelected = selectedAsset.address === parse(Address, marketUSDCAddress);
  const borrow = exaUSDC?.fixedBorrowPositions.find((b) => b.maturity === BigInt(success ? maturity : 0));
  const previewValue =
    borrow && exaUSDC ? (borrow.previewValue * exaUSDC.usdPrice) / 10n ** BigInt(exaUSDC.decimals) : 0n;
  const positionValue =
    borrow && exaUSDC
      ? ((borrow.position.principal + borrow.position.fee) * exaUSDC.usdPrice) / 10n ** BigInt(exaUSDC.decimals)
      : 0n;
  const discount = positionValue === 0n ? 0 : Number(WAD - (previewValue * WAD) / positionValue) / 1e18;
  const feeValue = borrow
    ? (fixedRate(borrow.maturity, borrow.position.principal, borrow.position.fee, timestamp) *
        borrow.position.principal) /
      10n ** BigInt(exaUSDC ? exaUSDC.decimals : 0)
    : 0n;

  const positions = markets
    ?.map((market) => ({
      ...market,
      usdValue: (market.floatingDepositAssets * market.usdPrice) / BigInt(10 ** market.decimals),
    }))
    .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0n);

  const repayMarket = positions?.find((p) => p.market === selectedAsset.address);
  const repayMarketAvailable =
    markets && !selectedAsset.isExternalAsset ? withdrawLimit(markets, selectedAsset.address) : 0n;

  const slippage = (WAD * 102n) / 100n;
  const maxRepay = borrow ? (borrow.previewValue * slippage) / WAD : 0n;

  const { data: route } = useQuery({
    initialData: { fromAmount: 0n, data: parse(Hex, "0x") },
    queryKey: ["lifi", "route", selectedAsset], // eslint-disable-line @tanstack/query/exhaustive-deps
    queryFn: async () => {
      if (!account || !borrow) return { fromAmount: 0n, data: parse(Hex, "0x") };
      if (repayMarket) {
        return await getRoute(
          repayMarket.asset,
          usdcAddress,
          maxRepay,
          account,
          isLatestPlugin ? account : exaPluginAddress,
        );
      }
      return await getRoute(selectedAsset.address, usdcAddress, maxRepay, account, account);
    },
    refetchInterval: 5000,
  });

  const positionAssets = borrow ? borrow.position.principal + borrow.position.fee : 0n;
  const maxAmountIn = (route.fromAmount * slippage) / WAD;

  const {
    data: repaySimulation,
    isPending: isSimulatingRepay,
    error: repaySimulationError,
  } = useSimulateContract(
    isLatestPlugin
      ? {
          address: account,
          functionName: "propose",
          args: [
            marketUSDCAddress,
            maxRepay,
            ProposalType.RepayAtMaturity,
            encodeAbiParameters(
              [
                {
                  type: "tuple",
                  components: [
                    { name: "maturity", type: "uint256" },
                    { name: "positionAssets", type: "uint256" },
                  ],
                },
              ],
              [{ maturity: success ? BigInt(maturity) : 0n, positionAssets }],
            ),
          ],
          abi: [...auditorAbi, ...marketAbi, ...upgradeableModularAccountAbi, ...exaPluginAbi],
          query: {
            retry: 2,
            enabled:
              !!account &&
              !!exaUSDC &&
              success &&
              !!maturity &&
              selectedAsset.address === parse(Address, marketUSDCAddress),
          },
        }
      : {
          address: account,
          functionName: "repay",
          args: [success ? BigInt(maturity) : 0n],
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
          query: {
            retry: 2,
            enabled:
              !!account &&
              !!exaUSDC &&
              success &&
              !!maturity &&
              selectedAsset.address === parse(Address, marketUSDCAddress),
          },
        },
  );

  const {
    data: crossRepaySimulation,
    error: crossRepaySimulationError,
    isPending: isSimulatingCrossRepay,
  } = useSimulateContract(
    isLatestPlugin
      ? {
          address: account,
          functionName: "propose",
          args: [
            selectedAsset.address,
            maxAmountIn,
            ProposalType.CrossRepayAtMaturity,
            encodeAbiParameters(
              [
                {
                  type: "tuple",
                  components: [
                    { name: "maturity", type: "uint256" },
                    { name: "positionAssets", type: "uint256" },
                    { name: "maxRepay", type: "uint256" },
                    { name: "route", type: "bytes" },
                  ],
                },
              ],
              [{ maturity: success ? BigInt(maturity) : 0n, positionAssets, maxRepay, route: route.data }],
            ),
          ],
          abi: [...auditorAbi, ...marketAbi, ...upgradeableModularAccountAbi, ...exaPluginAbi],
          query: {
            enabled:
              !!success && !!maturity && !!account && selectedAsset.address !== parse(Address, marketUSDCAddress),
          },
        }
      : {
          address: account,
          functionName: "crossRepay",
          args: [success ? BigInt(maturity) : 0n, selectedAsset.address],
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
          query: {
            enabled:
              !!success && !!maturity && !!account && selectedAsset.address !== parse(Address, marketUSDCAddress),
          },
        },
  );

  const simulationError = isUSDCSelected ? repaySimulationError : crossRepaySimulationError;

  const handlePayment = useCallback(() => {
    if (!repayMarket) return;
    setDisplayValues({
      amount: Number(isUSDCSelected ? positionAssets : route.fromAmount) / 10 ** repayMarket.decimals,
      usdAmount: Number(previewValue) / 1e18,
    });
    if (isUSDCSelected) {
      if (!repaySimulation) throw new Error("no repay simulation");
      repay(repaySimulation.request);
    } else {
      if (!crossRepaySimulation) throw new Error("no cross repay simulation");
      crossRepay(crossRepaySimulation.request);
    }
  }, [
    crossRepay,
    crossRepaySimulation,
    isUSDCSelected,
    positionAssets,
    previewValue,
    repay,
    repayMarket,
    repaySimulation,
    route.fromAmount,
  ]);

  const simulation = isUSDCSelected ? repaySimulation : crossRepaySimulation;
  const isSimulating = isUSDCSelected ? isSimulatingRepay : isSimulatingCrossRepay;

  const {
    mutateAsync: repayWithExternalAsset,
    isPending: isRepayingWithExternalAsset,
    isSuccess: isRepayWithExternalAssetSuccess,
    error: isRepayWithExternalAssetError,
  } = useMutation({
    mutationFn: async () => {
      if (!account) throw new Error("no account");
      if (!success) throw new Error("no maturity");
      if (!accountClient) throw new Error("no account client");
      if (!externalAsset) throw new Error("no external asset");
      if (!selectedAsset.isExternalAsset) throw new Error("not external asset");
      const lifiGatewayAddress = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE"; // TODO get from codegen
      setDisplayValues({
        amount: Number(route.fromAmount) / 10 ** externalAsset.decimals,
        usdAmount: (Number(externalAsset.priceUSD) * Number(route.fromAmount)) / 10 ** externalAsset.decimals,
      });
      const uo = await accountClient.sendUserOperation({
        uo: [
          {
            target: selectedAsset.address,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [lifiGatewayAddress, route.fromAmount],
            }),
          },
          { target: lifiGatewayAddress, data: route.data },
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
      return await accountClient.waitForUserOperationTransaction(uo);
    },
  });

  const isPending = isUSDCSelected
    ? isRepaying
    : selectedAsset.isExternalAsset
      ? isRepayingWithExternalAsset
      : isCrossRepaying;
  const isSuccess = isUSDCSelected
    ? isRepaySuccess
    : selectedAsset.isExternalAsset
      ? isRepayWithExternalAssetSuccess
      : isCrossRepaySuccess;
  const error = isUSDCSelected
    ? repayError
    : selectedAsset.isExternalAsset
      ? isRepayWithExternalAssetError
      : crossRepayError;

  if (selectedAsset.address === parse(Address, zeroAddress) && accountAssets[0]) {
    const { type } = accountAssets[0];
    setSelectedAsset({
      address: type === "external" ? parse(Address, accountAssets[0].address) : parse(Address, accountAssets[0].market),
      isExternalAsset: type === "external",
    });
  }

  if (!success) return;
  if (!isPending && !isSuccess && !error)
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
                {borrow && (
                  <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                    <Text secondary footnote textAlign="left">
                      Interest&nbsp;
                      {(
                        Number(fixedRate(borrow.maturity, borrow.position.principal, borrow.position.fee, timestamp)) /
                        1e18
                      )
                        .toLocaleString(undefined, {
                          style: "percent",
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })
                        .replaceAll(/\s+/g, "")}
                      &nbsp;APR
                    </Text>
                    <Text primary title3 textAlign="right">
                      {(Number(feeValue) / 1e18).toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Text>
                  </XStack>
                )}
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
                    {selectedAsset.isExternalAsset && externalAsset && (
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
                      <Skeleton height={20} width={100} colorMode={Appearance.getColorScheme() ?? "light"} />
                      <Skeleton height={20} width={100} colorMode={Appearance.getColorScheme() ?? "light"} />
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
                      {selectedAsset.isExternalAsset && externalAsset && (
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
              {selectedAsset.isExternalAsset ? (
                <Button
                  flexBasis={60}
                  onPress={() => {
                    repayWithExternalAsset().catch(reportError);
                  }}
                  contained
                  disabled={isRepayingWithExternalAsset || route.fromAmount > externalAssetAvailable}
                  main
                  spaced
                  fullwidth
                  iconAfter={
                    isRepayingWithExternalAsset ? (
                      <Spinner color="$interactiveOnDisabled" />
                    ) : (
                      <Coins
                        strokeWidth={2.5}
                        color={
                          route.fromAmount > externalAssetAvailable
                            ? "$interactiveOnDisabled"
                            : "$interactiveOnBaseBrandDefault"
                        }
                      />
                    )
                  }
                >
                  {isRepayingWithExternalAsset
                    ? "Please wait..."
                    : route.fromAmount > externalAssetAvailable
                      ? "Insufficient balance"
                      : "Confirm payment"}
                </Button>
              ) : (
                <Button
                  flexBasis={60}
                  onPress={handlePayment}
                  contained
                  disabled={!simulation || isSimulating}
                  main
                  spaced
                  fullwidth
                  iconAfter={
                    isSimulating ? (
                      <Spinner color="$interactiveOnDisabled" />
                    ) : (
                      <Coins
                        strokeWidth={2.5}
                        color={simulation ? "$interactiveOnBaseBrandDefault" : "$interactiveOnDisabled"}
                      />
                    )
                  }
                >
                  {isSimulating ? "Please wait..." : simulationError ? "Cannot proceed" : "Confirm payment"}
                </Button>
              )}
            </YStack>
          </View>
          <AssetSelectionSheet
            positions={positions}
            symbol={repayMarket?.assetSymbol ?? externalAsset?.symbol}
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
      />
    );
  if (error)
    return (
      <Failure
        maturity={maturity}
        amount={displayValues.amount}
        usdAmount={displayValues.usdAmount}
        currency={repayMarket?.assetSymbol ?? externalAsset?.symbol}
        selectedAsset={selectedAsset.address}
      />
    );
}
