import ProposalType from "@exactly/common/ProposalType";
import { exaPluginAddress } from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import { Address } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";
import { ArrowLeft, Coins, User, FilePen } from "@tamagui/lucide-icons";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { Avatar, ScrollView, XStack } from "tamagui";
import { bigint, check, parse, pipe } from "valibot";
import { encodeAbiParameters, erc20Abi, formatUnits, parseUnits, zeroAddress } from "viem";
import { useAccount, useBytecode, useSimulateContract, useWriteContract } from "wagmi";

import Failure from "./Failure";
import Pending from "./Pending";
import ReviewSheet from "./ReviewSheet";
import Success from "./Success";
import {
  exaPluginAbi,
  upgradeableModularAccountAbi,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "../../generated/contracts";
import queryClient, { type Withdraw } from "../../utils/queryClient";
import useAsset from "../../utils/useAsset";
import AmountSelector from "../shared/AmountSelector";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export interface WithdrawDetails {
  external: boolean;
  name?: string;
  amount: string;
  usdValue: string;
}

export default function Amount() {
  const { canGoBack } = router;
  const { address } = useAccount();
  const { t } = useTranslation();
  const [reviewOpen, setReviewOpen] = useState(false);
  const { data: withdraw } = useQuery<Withdraw>({ queryKey: ["withdrawal"] });
  const { market, externalAsset: external, available, isFetching } = useAsset(withdraw?.market);

  const form = useForm({
    defaultValues: { amount: withdraw?.amount ?? 0n },
    onSubmit: ({ value: { amount } }) => {
      queryClient.setQueryData<Withdraw>(["withdrawal"], (old) => (old ? { ...old, amount } : { amount }));
      router.push("/send-funds/withdraw");
    },
  });

  const formAmount = useStore(form.store, (state) => state.values.amount);

  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: address ?? zeroAddress,
    query: { enabled: !!address && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;

  const { data: proposeSimulation } = useSimulateContract(
    isLatestPlugin
      ? {
          address,
          functionName: "propose",
          abi: [...upgradeableModularAccountAbi, ...exaPluginAbi],
          args: [
            market?.market ?? zeroAddress,
            formAmount,
            ProposalType.Withdraw,
            encodeAbiParameters([{ type: "address" }], [withdraw?.receiver ?? zeroAddress]),
          ],
          query: { enabled: !!withdraw && !!market && !!address && !!bytecode && formAmount > 0n },
        }
      : {
          address,
          functionName: "propose",
          abi: [
            ...upgradeableModularAccountAbi,
            {
              type: "function",
              name: "propose",
              inputs: [
                { internalType: "contract IMarket", name: "market", type: "address" },
                { internalType: "uint256", name: "amount", type: "uint256" },
                { internalType: "address", name: "receiver", type: "address" },
              ],
              outputs: [],
              stateMutability: "nonpayable",
            },
          ],
          args: [market?.market ?? zeroAddress, formAmount, withdraw?.receiver ?? zeroAddress],
          query: { enabled: !!withdraw && !!market && !!address && !!bytecode && formAmount > 0n },
        },
  );

  const { data: transferSimulation } = useSimulateContract({
    address: parse(Address, external?.address ?? zeroAddress),
    abi: erc20Abi,
    functionName: "transfer",
    args: [withdraw?.receiver ?? zeroAddress, formAmount],
    query: {
      enabled: !!withdraw && !!external && !!address && !!bytecode && !!withdraw.receiver && formAmount > 0n,
    },
  });

  const { writeContract, data: hash, isPending: pending, isSuccess: success, isIdle: idle } = useWriteContract();

  const handleSubmit = useCallback(() => {
    if (market) {
      if (!proposeSimulation) throw new Error("no propose simulation");
      writeContract(proposeSimulation.request);
    } else {
      if (!external) throw new Error("no external asset");
      if (!transferSimulation) throw new Error("no transfer simulation");
      writeContract(transferSimulation.request);
    }
  }, [market, proposeSimulation, writeContract, external, transferSimulation]);

  const details: WithdrawDetails = useMemo(
    () =>
      market
        ? {
            external: false,
            name: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
            amount: formatUnits(formAmount, market.decimals),
            usdValue: formatUnits((formAmount * market.usdPrice) / WAD, market.decimals),
          }
        : {
            external: true,
            name: external?.symbol,
            amount: formatUnits(formAmount, external?.decimals ?? 0),
            usdValue: formatUnits(
              (formAmount * parseUnits(external?.priceUSD ?? "0", 18)) / WAD,
              external?.decimals ?? 0,
            ),
          },
    [external, market, formAmount],
  );

  const { data: recentContacts } = useQuery<{ address: Address; ens: string }[] | undefined>({
    queryKey: ["contacts", "recent"],
  });

  const canSend = market ? !!proposeSimulation : !!transferSimulation;
  const isFirstSend = !recentContacts?.some((contact) => contact.address === withdraw?.receiver);

  useEffect(() => {
    if (success) {
      queryClient.setQueryData<{ address: Address; ens: string }[] | undefined>(["contacts", "recent"], (old) =>
        [{ address: parse(Address, withdraw?.receiver), ens: "" }, ...(old ?? [])].slice(0, 3),
      );
    }
  }, [success, withdraw?.receiver]);
  if (idle)
    return (
      <SafeView fullScreen>
        <View gap={20} fullScreen padded>
          <View flexDirection="row" gap={10} justifyContent="space-around" alignItems="center">
            <View position="absolute" left={0}>
              <Pressable
                onPress={() => {
                  if (canGoBack()) {
                    router.back();
                    return;
                  }
                  router.replace("/send-funds");
                }}
              >
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
            </View>
            <Text color="$uiNeutralPrimary" fontSize={15} fontWeight="bold">
              {t("Enter amount")}
            </Text>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            // eslint-disable-next-line react-native/no-inline-styles
            contentContainerStyle={{ flexGrow: 1 }}
            gap="$s5"
          >
            <View flex={1} gap="$s5" paddingBottom="$s5">
              <View gap="$s3">
                <XStack
                  alignItems="center"
                  backgroundColor="$backgroundBrandSoft"
                  borderRadius="$r2"
                  justifyContent="space-between"
                >
                  <XStack alignItems="center" gap="$s3" padding="$s3">
                    <Avatar size={32} backgroundColor="$interactiveBaseBrandDefault" borderRadius="$r_0">
                      <User size={20} color="$interactiveOnBaseBrandDefault" />
                    </Avatar>
                    <Text emphasized callout color="$uiNeutralSecondary">
                      {t("To")}:
                    </Text>
                    <Text callout color="$uiNeutralPrimary" fontFamily="$mono">
                      {withdraw?.receiver ? shortenHex(withdraw.receiver) : "..."}
                    </Text>
                  </XStack>
                </XStack>
                <XStack
                  alignItems="center"
                  backgroundColor="$backgroundBrandSoft"
                  borderRadius="$r2"
                  justifyContent="space-between"
                  gap="$s3"
                >
                  {isFetching ? (
                    <Skeleton width="100%" height={45} />
                  ) : (
                    <XStack alignItems="center" gap="$s3" padding="$s3">
                      <Avatar size={32} backgroundColor="$interactiveBaseBrandDefault" borderRadius="$r_0">
                        <Coins size={20} color="$interactiveOnBaseBrandDefault" />
                      </Avatar>
                      <Text callout color="$uiNeutralSecondary">
                        {t("Available")}:
                      </Text>
                      <Text callout color="$uiNeutralPrimary" numberOfLines={1}>
                        {market ? (
                          <>
                            {`${(Number(available) / 10 ** market.decimals).toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: market.decimals,
                              useGrouping: false,
                            })} ${market.symbol.slice(3)}`}
                          </>
                        ) : external ? (
                          <>
                            {`${(Number(available) / 10 ** external.decimals).toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: external.decimals,
                              useGrouping: false,
                            })} ${external.symbol}`}
                          </>
                        ) : null}
                      </Text>
                    </XStack>
                  )}
                </XStack>
              </View>
              <form.Field
                name="amount"
                validators={{
                  onChange: pipe(
                    bigint(),
                    check(
                      (value) => {
                        return value !== 0n;
                      },
                      t("Amount cannot be {{amount}}", { amount: 0 }),
                    ),
                    check((value) => {
                      return value <= available;
                    }, t("Amount cannot be greater than available")),
                  ),
                }}
              >
                {({ state: { meta }, handleChange }) => (
                  <>
                    <AmountSelector onChange={handleChange} />
                    {meta.errors.length > 0 ? (
                      <Text padding="$s3" footnote color="$uiNeutralSecondary">
                        {meta.errors[0]?.message.split(",")[0]}
                      </Text>
                    ) : undefined}
                  </>
                )}
              </form.Field>
            </View>
            <form.Subscribe selector={({ isValid, isTouched }) => [isValid, isTouched]}>
              {([isValid, isTouched]) => {
                return (
                  <Button
                    contained
                    main
                    spaced
                    disabled={!isValid || !isTouched}
                    iconAfter={
                      <FilePen
                        color={isValid && isTouched ? "$interactiveOnBaseBrandDefault" : "$interactiveOnDisabled"}
                      />
                    }
                    onPress={() => {
                      setReviewOpen(true);
                    }}
                  >
                    {t("Review")}
                  </Button>
                );
              }}
            </form.Subscribe>
          </ScrollView>
        </View>
        <ReviewSheet
          open={reviewOpen}
          onClose={() => {
            setReviewOpen(false);
          }}
          onSend={() => {
            setReviewOpen(false);
            handleSubmit();
          }}
          canSend={canSend}
          details={details}
          isFirstSend={isFirstSend}
        />
      </SafeView>
    );
  if (pending) return <Pending details={details} />;
  if (success) return <Success details={details} hash={hash} />;
  return (
    <Failure
      details={details}
      hash={hash}
      onClose={() => {
        if (isLatestPlugin) {
          router.replace("/pending-proposals");
        } else {
          router.back();
        }
      }}
    />
  );
}
