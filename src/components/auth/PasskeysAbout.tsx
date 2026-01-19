import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { X } from "@tamagui/lucide-icons";
import { ScrollView, YStack } from "tamagui";

import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PasskeysAbout() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <SafeView fullScreen paddingTop={0} backgroundColor="$backgroundSoft">
      <View
        flexDirection="column"
        alignItems="center"
        position="relative"
        backgroundColor="$backgroundSoft"
        justifyContent="space-between"
        fullScreen
      >
        <View
          position="relative"
          height={4}
          width={40}
          borderRadius="$r_0"
          marginTop="$s3"
          backgroundColor="$backgroundMild"
        />
        <View flex={1} paddingVertical="$s8" paddingHorizontal="$s4" alignItems="center">
          <View flex={1} flexDirection="column" justifyContent="space-between" gap="$s5">
            <ScrollView flex={1} showsVerticalScrollIndicator={false}>
              <View flex={1} gap="$s8">
                <View gap="$s5">
                  <Text fontSize={17} fontWeight="bold" textAlign="left">
                    {t("How passkeys work")}
                  </Text>
                  <Text fontSize={16} color="$uiNeutralSecondary" textAlign="left">
                    {t(
                      "Passkeys replace passwords with cryptographic keys. Your private key stays on your device, while the public key is shared with the service. This ensures secure and seamless authentication.",
                    )}
                  </Text>
                </View>
                <YStack gap="$s5">
                  <Text fontSize={17} fontWeight="bold" textAlign="left">
                    {t("Passkeys advantages")}
                  </Text>
                  {advantages.map(({ title, body }) => (
                    <YStack key={title} gap="$s4">
                      <Text callout emphasized secondary>
                        {t(title)}
                      </Text>
                      <Text callout secondary>
                        {t(body)}
                      </Text>
                    </YStack>
                  ))}
                </YStack>
              </View>
            </ScrollView>
            <Button
              outlined
              main
              spaced
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/passkeys");
                }
              }}
              fontWeight="bold"
              iconAfter={<X color="$interactiveOnBaseBrandSoft" />}
            >
              {t("Close")}
            </Button>
          </View>
        </View>
      </View>
    </SafeView>
  );
}

const advantages = [
  { title: "Strong credentials.", body: "Every passkey is strong. They're never guessable, reused, or weak." },
  {
    title: "Safe from server leaks.",
    body: "Because servers only keep public keys, servers are less valuable targets for hackers.",
  },
  {
    title: "Safe from phishing.",
    body: "Passkeys are intrinsically linked with the app or website they were created for, so people can never be tricked into using their passkey to sign in to a fraudulent app or website.",
  },
];
