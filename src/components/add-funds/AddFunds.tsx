import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import type { Credential } from "@exactly/common/validation";
import { useAppKit, useAppKitState } from "@reown/appkit-react-native";
import { ArrowLeft, CircleHelp, Info, Wallet } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable } from "react-native";
import { ScrollView, useTheme, XStack, YStack } from "tamagui";
import { isAddress } from "viem";

import AddFundsOption from "./AddFundsOption";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import OptimismImage from "../../assets/images/optimism.svg";
import WalletConnectImage from "../../assets/images/walletconnect.svg";
import type { AuthMethod } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AddFunds() {
  const theme = useTheme();
  const { open } = useAppKit();
  const { presentArticle } = useIntercom();
  const navigation = useNavigation<AppNavigationProperties>();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: method } = useQuery<AuthMethod>({ queryKey: ["method"] });
  const { t } = useTranslation();
  const ownerAccount = credential && isAddress(credential.credentialId) ? credential.credentialId : undefined;

  const { isConnected, isOpen } = useAppKitState();

  useEffect(() => {
    if (isConnected && isOpen) navigation.navigate("add-funds", { screen: "bridge", params: { sender: "external" } });
  }, [isConnected, isOpen, navigation]);

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap={20} fullScreen padded>
        <YStack gap={20}>
          <XStack flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
            <Pressable
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.replace("(home)", { screen: "index" });
                }
              }}
            >
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
            <Text emphasized subHeadline primary>
              {t("Add Funds")}
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
          <YStack flex={1} gap="$s3_5">
            {method === "siwe" && ownerAccount && (
              <AddFundsOption
                icon={<Wallet width={30} height={30} color="$iconBrandDefault" />}
                title={t("From connected wallet")}
                subtitle={shortenHex(ownerAccount, 4, 6)}
                onPress={() => {
                  navigation.navigate("add-funds", { screen: "bridge" });
                }}
              />
            )}
            <AddFundsOption
              icon={<WalletConnectImage width={30} height={30} fill={theme.interactiveOnBaseBrandSoft.val} />}
              title={t("Using WalletConnect")}
              subtitle={Platform.OS === "web" ? t("From another wallet") : t("From another wallet on your device")}
              onPress={open}
            />
            <AddFundsOption
              icon={<OptimismImage width={30} height={30} />}
              title={t("From another wallet")}
              subtitle={t("On {{chain}}", { chain: chain.name })}
              onPress={() => {
                navigation.navigate("add-funds", { screen: "add-crypto" });
              }}
            />
          </YStack>
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
              {t("Assets are added to your balance as collateral to increase your credit limit.")}
              <Text
                cursor="pointer"
                emphasized
                caption2
                color="$uiBrandSecondary"
                onPress={() => {
                  presentArticle("8950805").catch(reportError);
                }}
              >
                &nbsp;{t("Learn more about collateral.")}
              </Text>
            </Text>
          </XStack>
        </XStack>
      </View>
    </SafeView>
  );
}
