import shortenHex from "@exactly/common/shortenHex";
import { Address } from "@exactly/common/validation";
import { ArrowLeft, UserMinus, UserPlus } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation } from "expo-router";
import React from "react";
import { Alert, Pressable } from "react-native";
import { Avatar, ScrollView, XStack } from "tamagui";
import { parse } from "valibot";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import queryClient from "../../utils/queryClient";
import AssetSelector from "../shared/AssetSelector";
import Blocky from "../shared/Blocky";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AssetSelection() {
  const navigation = useNavigation<AppNavigationProperties>();
  const { receiver: receiverAddress } = useLocalSearchParams();
  const receiver = parse(Address, receiverAddress);

  const { data: savedContacts } = useQuery<{ address: Address; ens: string }[] | undefined>({
    queryKey: ["contacts", "saved"],
  });

  const handleSubmit = (asset: Address, external: boolean) => {
    navigation.navigate("send-funds", {
      screen: "amount",
      params: { receiver, asset, external: String(external) },
    });
  };

  const hasContact = savedContacts?.find((contact) => contact.address === receiver);

  return (
    <SafeView fullScreen>
      <View gap={20} fullScreen padded>
        <View flexDirection="row" gap={10} justifyContent="space-around" alignItems="center">
          <View position="absolute" left={0}>
            <Pressable
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.replace("send-funds", { screen: "index" });
                }
              }}
            >
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
          </View>
          <Text emphasized color="$uiNeutralPrimary" fontSize={15}>
            Choose asset
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
                  To:
                </Text>
                <Text callout color="$uiNeutralPrimary" fontFamily="$mono">
                  {shortenHex(receiver)}
                </Text>
              </XStack>
              <Button
                backgroundColor={hasContact ? "$interactiveBaseErrorSoftDefault" : "$interactiveBaseBrandSoftDefault"}
                padding="$s3_5"
                onPress={() => {
                  queryClient.setQueryData<{ name: string; address: Address; ens: string }[] | undefined>(
                    ["contacts", "saved"],
                    (old) => {
                      if (hasContact) {
                        return old?.filter((contact) => contact.address !== receiver);
                      } else {
                        return old && old.length > 0
                          ? [...old, { name: "New Contact", address: receiver, ens: "" }]
                          : [{ name: "New Contact", address: receiver, ens: "" }];
                      }
                    },
                  );
                  Alert.alert(
                    hasContact ? "Contact removed" : "Contact added",
                    hasContact
                      ? "This address has been removed from your contacts list."
                      : "This address has been added to your contacts list.",
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
