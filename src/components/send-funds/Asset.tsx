import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft } from "@tamagui/lucide-icons";
import { ScrollView } from "tamagui";

import AssetSelector from "../shared/AssetSelector";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AssetSelection() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <View flexDirection="row" gap="$s3_5" justifyContent="space-around" alignItems="center">
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
            <AssetSelector
              onSubmit={(asset, external) => {
                router.push({ pathname: "/send-funds/destination", params: { asset, external: String(external) } });
              }}
            />
          </View>
        </ScrollView>
      </View>
    </SafeView>
  );
}
