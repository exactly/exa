import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import type { Credential } from "@exactly/common/validation";
import { ArrowLeft, CircleHelp, Info, Wallet } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React, { useCallback } from "react";
import { Linking, Platform, Pressable } from "react-native";
import { ScrollView, useTheme, XStack, YStack } from "tamagui";
import { isAddress } from "viem";
import { ConnectorAlreadyConnectedError, useConnect, useConnectors } from "wagmi";

import AddFundsOption from "./AddFundsOption";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import OptimismImage from "../../assets/images/optimism.svg";
import WalletConnectImage from "../../assets/images/walletconnect.svg";
import type { AuthMethod } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import externalConfig from "../../utils/wagmi/external";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AddFunds() {
  const theme = useTheme();
  const { presentArticle } = useIntercom();
  const navigation = useNavigation<AppNavigationProperties>();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: method } = useQuery<AuthMethod>({ queryKey: ["method"] });
  const ownerAccount = credential && isAddress(credential.credentialId) ? credential.credentialId : undefined;

  const [walletConnect] = useConnectors({ config: externalConfig });
  const { connectAsync } = useConnect({ config: externalConfig });

  const connectExternal = useCallback(() => {
    if (!walletConnect) throw new Error("no wallet connect connector");
    walletConnect
      .getProvider()
      .then(async (provider) => {
        provider.once("display_uri", (uri) => {
          if (Platform.OS === "web") return;
          Linking.openURL(uri).catch(reportError);
        });
        try {
          await connectAsync({ connector: walletConnect });
          navigation.navigate("add-funds", { screen: "bridge", params: { sender: "external" } });
        } catch (error) {
          if (error instanceof ConnectorAlreadyConnectedError) {
            navigation.navigate("add-funds", { screen: "bridge", params: { sender: "external" } });
            return;
          }
          reportError(error);
        }
      })
      .catch(reportError);
  }, [connectAsync, navigation, walletConnect]);

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
          <YStack flex={1} gap="$s3_5">
            {method === "siwe" && ownerAccount && (
              <AddFundsOption
                icon={<Wallet width={30} height={30} color="$iconBrandDefault" />}
                title="From connected wallet"
                subtitle={shortenHex(ownerAccount, 4, 6)}
                onPress={() => {
                  navigation.navigate("add-funds", { screen: "bridge" });
                }}
              />
            )}
            <AddFundsOption
              icon={<WalletConnectImage width={30} height={30} fill={theme.interactiveOnBaseBrandSoft.val} />}
              title="Using WalletConnect"
              subtitle={`From another wallet ${Platform.OS === "web" ? "" : "on your device"}`}
              onPress={connectExternal}
            />
            <AddFundsOption
              icon={<OptimismImage width={30} height={30} />}
              title="From another wallet"
              subtitle={`On ${chain.name}`}
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
