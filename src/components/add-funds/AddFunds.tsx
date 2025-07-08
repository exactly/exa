import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import type { Credential } from "@exactly/common/validation";
import { ArrowLeft, CircleHelp, Info, Wallet } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";
import { isAddress } from "viem";

import AddFundsOption from "./AddFundsOption";
import OptimismImage from "../../assets/images/optimism.svg";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AddFunds() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const ownerAccount = credential && isAddress(credential.credentialId) ? credential.credentialId : undefined;
  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap={20} fullScreen padded>
        <YStack gap={20}>
          <XStack flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
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
            <AddFundsOption
              icon={<Wallet width={40} height={40} color="$iconBrandDefault" />}
              title={t("From connected wallet")}
              subtitle={
                // TODO add support for ens resolution
                ownerAccount ? shortenHex(ownerAccount, 4, 6) : ""
              }
              onPress={() => {
                router.push("/add-funds/bridge");
              }}
            />
            <AddFundsOption
              icon={<OptimismImage width={40} height={40} />}
              title={t("From another wallet")}
              subtitle={t("On {{chain}}", { chain: chain.name })}
              onPress={() => {
                router.push("/add-funds/add-crypto");
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
