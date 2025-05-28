import shortenHex from "@exactly/common/shortenHex";
import { Address } from "@exactly/common/validation";
import { ArrowLeft, User, UserMinus, UserPlus } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React from "react";
import { Alert, Pressable } from "react-native";
import { Avatar, ScrollView, XStack } from "tamagui";
import { parse } from "valibot";

import queryClient, { type Withdraw } from "../../utils/queryClient";
import AssetSelector from "../shared/AssetSelector";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AssetSelection() {
  const { canGoBack } = router;
  const { data: withdraw } = useQuery<Withdraw>({ queryKey: ["withdrawal"] });
  const { data: savedContacts } = useQuery<{ address: Address; ens: string }[] | undefined>({
    queryKey: ["contacts", "saved"],
  });
  const handleSubmit = (market: Address, isExternalAsset: boolean) => {
    queryClient.setQueryData<Withdraw>(["withdrawal"], (old) => {
      return old ? { ...old, market, isExternalAsset } : { market, isExternalAsset, amount: 0n };
    });
    router.push("/send-funds/amount");
  };
  const hasContact = savedContacts?.find((contact) => contact.address === withdraw?.receiver);
  return (
    <SafeView fullScreen>
      <View gap={20} fullScreen padded>
        <View flexDirection="row" gap={10} justifyContent="space-around" alignItems="center">
          <View position="absolute" left={0}>
            {canGoBack() && (
              <Pressable
                onPress={() => {
                  router.back();
                }}
              >
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
            )}
          </View>
          <Text emphasized color="$uiNeutralPrimary" fontSize={15}>
            Choose asset
          </Text>
        </View>
        <ScrollView flex={1}>
          <View flex={1} gap="$s5">
            {withdraw?.receiver && (
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
                    <User size={20} color="$interactiveOnBaseBrandDefault" />
                  </Avatar>
                  <Text emphasized callout color="$uiNeutralSecondary">
                    To:
                  </Text>
                  <Text callout color="$uiNeutralPrimary" fontFamily="$mono">
                    {shortenHex(withdraw.receiver)}
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
                          return old?.filter((contact) => contact.address !== withdraw.receiver);
                        } else {
                          return old && old.length > 0
                            ? [...old, { name: "New Contact", address: parse(Address, withdraw.receiver), ens: "" }]
                            : [{ name: "New Contact", address: parse(Address, withdraw.receiver), ens: "" }];
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
            )}
            <AssetSelector
              onSubmit={(market, isExternalAsset) => {
                handleSubmit(market, isExternalAsset);
              }}
            />
          </View>
        </ScrollView>
      </View>
    </SafeView>
  );
}
