import { X } from "@tamagui/lucide-icons";
import { useNavigation } from "expo-router";
import React from "react";
import { ScrollView } from "tamagui";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PasskeysAbout() {
  const navigation = useNavigation<AppNavigationProperties>();
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
                    How passkeys work
                  </Text>
                  <Text fontSize={16} color="$uiNeutralSecondary" textAlign="left">
                    Passkeys replace passwords with cryptographic keys. Your private key stays on your device, while the
                    public key is shared with the service. This ensures secure and seamless authentication.
                  </Text>
                </View>
                <View gap="$s5">
                  <Text fontSize={17} fontWeight="bold" textAlign="left">
                    Passkeys advantages
                  </Text>
                  <Text fontSize={16} color="$uiNeutralSecondary" textAlign="left">
                    <Text color="$uiNeutralSecondary" fontWeight="bold">
                      {`Strong credentials.   `}
                    </Text>
                    Every passkey is strong. They&apos;re never guessable, reused, or weak.
                  </Text>
                  <Text fontSize={16} color="$uiNeutralSecondary" textAlign="left">
                    <Text color="$uiNeutralSecondary" fontWeight="bold">
                      {`Safe from server leaks.   `}
                    </Text>
                    Because servers only keep public keys, servers are less valuable targets for hackers.
                  </Text>
                  <Text fontSize={16} color="$uiNeutralSecondary" textAlign="left">
                    <Text color="$uiNeutralSecondary" fontWeight="bold">
                      {`Safe from phishing.   `}
                    </Text>
                    Passkeys are intrinsically linked with the app or website they were created for, so people can never
                    be tricked into using their passkey to sign in to a fraudulent app or website.
                  </Text>
                </View>
              </View>
            </ScrollView>
            <Button
              outlined
              main
              spaced
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.replace("(passkeys)", { screen: "passkeys" });
                }
              }}
              fontWeight="bold"
              iconAfter={<X color="$interactiveOnBaseBrandSoft" />}
            >
              Close
            </Button>
          </View>
        </View>
      </View>
    </SafeView>
  );
}
