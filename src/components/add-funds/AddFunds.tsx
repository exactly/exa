import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import type { Credential } from "@exactly/common/validation";
import { ArrowLeft, CircleHelp, Info, Wallet } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { ScrollView, Spinner, XStack, YStack } from "tamagui";
import { isAddress } from "viem";

import AddFiatButton from "./AddFiatButton";
import AddFundsOption from "./AddFundsOption";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import OptimismImage from "../../assets/images/optimism.svg";
import publicClient from "../../utils/publicClient";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import useOnRampProviders from "../../utils/useOnRampProviders";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AddFunds() {
  const { presentArticle } = useIntercom();
  const navigation = useNavigation<AppNavigationProperties>();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const ownerAccount = credential && isAddress(credential.credentialId) ? credential.credentialId : undefined;

  const { data: ownerEns } = useQuery<string | null>({
    queryKey: ["ens-name", ownerAccount],
    enabled: Boolean(ownerAccount),
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      if (!ownerAccount) return null;
      try {
        return await publicClient.getEnsName({ address: ownerAccount });
      } catch (error) {
        reportError(error);
        return null;
      }
    },
  });

  const { data: providers, isPending } = useOnRampProviders();
  console.log("providers", providers);

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap={20} fullScreen padded>
        <YStack gap={20}>
          <XStack flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
            <Pressable
              onPress={() => {
                navigation.replace("(home)", { screen: "index" });
              }}
            >
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
            <Text emphasized subHeadline primary>
              Add Funds
            </Text>
            <Pressable
              onPress={() => {
                presentArticle("8950805").catch(reportError);
              }}
            >
              <CircleHelp color="$uiNeutralPrimary" />
            </Pressable>
          </XStack>
        </YStack>

        <ScrollView flex={1}>
          <View flex={1} gap={20}>
            {isPending ? (
              <View padding="$s6" justifyContent="center" alignItems="center">
                <Spinner size="large" />
              </View>
            ) : (
              <YStack flex={1} gap="$s3_5">
                <AddFundsOption
                  icon={<Wallet width={40} height={40} color="$iconBrandDefault" />}
                  title="From connected wallet"
                  subtitle={ownerEns ?? (ownerAccount ? shortenHex(ownerAccount, 4, 6) : "")}
                  onPress={() => {
                    navigation.navigate("add-funds", { screen: "bridge" });
                  }}
                />
                <AddFundsOption
                  icon={<OptimismImage width={40} height={40} />}
                  title="From another wallet"
                  subtitle={`On ${chain.name}`}
                  onPress={() => {
                    navigation.navigate("add-funds", { screen: "add-crypto" });
                  }}
                />

                {providers &&
                  Object.entries(providers.providers).flatMap(([providerKey, providerData]) => {
                    const allCurrencies = new Set([
                      ...providerData.currencies,
                      ...(providerData.pendingTasks?.[0]?.currencies ?? []),
                    ]);

                    return [...allCurrencies].map((currency) => (
                      <AddFiatButton
                        key={`${providerKey}-${currency}`}
                        provider={providerKey}
                        currency={currency}
                        data={providerData}
                      />
                    ));
                  })}
              </YStack>
            )}

            <View flex={1}>
              <Text color="$uiNeutralPlaceholder" fontSize={13} textAlign="justify">
                Assets are added to your balance as collateral to increase your credit limit. You can change collateral
                preferences in your account.
                <Text color="$uiBrandSecondary" fontSize={13} fontWeight="bold">
                  &nbsp;Learn more about collateral.
                </Text>
              </Text>
            </View>
          </View>
        </ScrollView>
        <XStack
          gap="$s4"
          alignItems="flex-start"
          borderTopWidth={1}
          borderTopColor="$borderNeutralSoft"
          paddingTop="$s3"
        >
          <View>
            <Info size={16} width={16} height={16} color="$uiInfoSecondary" />
          </View>
          <XStack flex={1}>
            <Text emphasized caption2 color="$uiNeutralPlaceholder">
              Assets are added to your balance as collateral to increase your credit limit.
              <Text
                cursor="pointer"
                emphasized
                caption2
                color="$uiBrandSecondary"
                onPress={() => {
                  presentArticle("8950805").catch(reportError);
                }}
              >
                &nbsp;Learn more about collateral.
              </Text>
            </Text>
          </XStack>
        </XStack>
      </View>
    </SafeView>
  );
}
