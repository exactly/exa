import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowRight } from "@tamagui/lucide-icons-2";

import accountCreated from "../../assets/images/account-created.webp";
import Image from "../shared/Image";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Success() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View fullScreen padded>
        <View justifyContent="center" alignItems="center" flexGrow={1} flexShrink={1}>
          <Image
            source={accountCreated}
            contentFit="contain"
            width="100%"
            aspectRatio={1}
            flexShrink={1}
            paddingHorizontal="$s5"
          />
          <View gap="$s5" justifyContent="center">
            <Text emphasized title brand centered>
              {t("Account created successfully!")}
            </Text>
          </View>
        </View>
        <View>
          <View flexDirection="row" alignSelf="stretch">
            <Button
              primary
              flex={1}
              marginTop="$s4"
              marginBottom="$s5"
              onPress={() => {
                router.replace("/(main)/(home)");
              }}
            >
              <Button.Text>{t("Get started")}</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
          </View>
        </View>
      </View>
    </SafeView>
  );
}
