import React from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable } from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, UserMinus, UserPlus } from "@tamagui/lucide-icons";
import { Avatar, ScrollView, XStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { parse } from "valibot";

import shortenHex from "@exactly/common/shortenHex";
import { Address } from "@exactly/common/validation";

import queryClient from "../../utils/queryClient";
import AssetSelector from "../shared/AssetSelector";
import Blocky from "../shared/Blocky";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AssetSelection() {
  const router = useRouter();
  const { receiver: receiverAddress } = useLocalSearchParams();
  const receiver = parse(Address, receiverAddress);
  const { t } = useTranslation();

  const { data: savedContacts } = useQuery<undefined | { address: Address; ens: string }[]>({
    queryKey: ["contacts", "saved"],
  });

  const handleSubmit = (asset: Address, external: boolean) => {
    router.push({ pathname: "/send-funds/amount", params: { receiver, asset, external: String(external) } });
  };

  const hasContact = savedContacts?.find((contact) => contact.address === receiver);

  return (
    <SafeView fullScreen>
      <View gap={20} fullScreen padded>
        <View flexDirection="row" gap={10} justifyContent="space-around" alignItems="center">
          <View position="absolute" left={0}>
            <Pressable
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/send-funds");
                }
              }}
            >
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
          </View>
          <Text emphasized color="$uiNeutralPrimary" fontSize={15}>
            {t("Choose asset")}
          </Text>
        </View>
        <ScrollView flex={1}>
          <View flex={1} gap="$s5">
            <XStack
              alignItems="center"
              backgroundColor="$backgroundBrandSoft"
              borderRadius="$r2"
              justifyContent="space-between"
              paddingVertical="$s2"
              paddingHorizontal="$s2"
            >
              <XStack alignItems="center" gap="$s3" paddingHorizontal="$s1">
                <Avatar size={32} backgroundColor="$interactiveBaseBrandDefault" borderRadius="$r_0">
                  <Blocky seed={receiver} />
                </Avatar>
                <Text emphasized callout color="$uiNeutralSecondary">
                  {t("To:")}
                </Text>
                <Text callout color="$uiNeutralPrimary" fontFamily="$mono">
                  {shortenHex(receiver)}
                </Text>
              </XStack>
              <Button
                backgroundColor={hasContact ? "$interactiveBaseErrorSoftDefault" : "$interactiveBaseBrandSoftDefault"}
                padding="$s3_5"
                onPress={() => {
                  queryClient.setQueryData<undefined | { address: Address; ens: string; name: string }[]>(
                    ["contacts", "saved"],
                    (old) => {
                      if (hasContact) {
                        return old?.filter((contact) => contact.address !== receiver);
                      }
                      const newContact = { name: t("New Contact"), address: receiver, ens: "" };
                      return [...(old ?? []), newContact];
                    },
                  );
                  Alert.alert(
                    hasContact ? t("Contact removed") : t("Contact added"),
                    hasContact
                      ? t("This address has been removed from your contacts list.")
                      : t("This address has been added to your contacts list."),
                  );
                }}
              >
                {hasContact ? (
                  <UserMinus size={24} color="$interactiveOnBaseErrorSoft" />
                ) : (
                  <UserPlus size={24} color="$interactiveOnBaseBrandSoft" />
                )}
              </Button>
            </XStack>
            <AssetSelector
              onSubmit={(market, external) => {
                handleSubmit(market, external);
              }}
            />
          </View>
        </ScrollView>
      </View>
    </SafeView>
  );
}
