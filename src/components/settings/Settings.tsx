import { ArrowLeft, Check, HelpCircle, LogOut, SendHorizontal } from "@tamagui/lucide-icons";
import { setStringAsync } from "expo-clipboard";
import { useNavigation } from "expo-router";
import React from "react";
import { Alert, Pressable } from "react-native";
import { ScrollView, Separator, XStack } from "tamagui";
import { useDisconnect } from "wagmi";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import release from "../../generated/release";
import { useSubmitCoverage } from "../../utils/e2e";
import { present, logout as logoutIntercom } from "../../utils/intercom";
import { logout as logoutOnesignal } from "../../utils/onesignal";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Settings() {
  const navigation = useNavigation<AppNavigationProperties>();
  const { connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { mutate: submitCoverage, isSuccess: coverageSuccess, isError: coverageError } = useSubmitCoverage();
  return (
    <SafeView fullScreen tab>
      <View fullScreen padded gap="$s5">
        <View flexDirection="row" gap="$s3" justifyContent="space-around" alignItems="center">
          <View position="absolute" left={0}>
            <Pressable
              aria-label="Back"
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
          </View>
          <Text emphasized subHeadline color="$uiNeutralPrimary">
            Settings
          </Text>
        </View>
        <ScrollView flex={1}>
          <View gap="$s4_5">
            <View borderRadius="$r3" borderWidth={1} borderColor="$borderNeutralSoft">
              <Separator borderColor="$borderNeutralSoft" />
              <Pressable
                onPress={() => {
                  present().catch(reportError);
                }}
              >
                <XStack justifyContent="space-between" alignItems="center" padding="$s4">
                  <XStack gap="$s3" justifyContent="flex-start" alignItems="center">
                    <HelpCircle color="$backgroundBrand" />
                    <Text subHeadline color="$uiNeutralPrimary">
                      Support
                    </Text>
                  </XStack>
                </XStack>
              </Pressable>
              <Separator borderColor="$borderNeutralSoft" />
              <Pressable
                onPress={() => {
                  if (!connector) return;
                  Promise.all([queryClient.cancelQueries(), logoutIntercom()])
                    .then(() => {
                      logoutOnesignal();
                      queryClient.clear();
                      queryClient.unmount();
                      disconnect({ connector });
                      navigation.replace("(auth)");
                    })
                    .catch(reportError);
                }}
              >
                <XStack justifyContent="space-between" alignItems="center" padding="$s4">
                  <XStack gap="$s3" justifyContent="flex-start" alignItems="center">
                    <LogOut color="$interactiveBaseErrorDefault" />
                    <Text subHeadline color="$uiNeutralPrimary">
                      Logout
                    </Text>
                  </XStack>
                </XStack>
              </Pressable>
            </View>
            <View borderRadius="$r3" borderWidth={1} borderColor="$borderNeutralSoft">
              <Separator borderColor="$borderNeutralSoft" />
              <Pressable onPress={() => submitCoverage()}>
                <XStack justifyContent="space-between" alignItems="center" padding="$s4">
                  <XStack justifyContent="space-between" flex={1}>
                    <XStack justifyContent="flex-start" alignItems="center" gap="$s3">
                      <SendHorizontal color="$backgroundBrand" />
                      <Text subHeadline color="$uiNeutralPrimary">
                        Submit coverage
                      </Text>
                    </XStack>
                    {(coverageSuccess || coverageError) && (
                      <Check
                        accessibilityLabel="Finished"
                        color={coverageSuccess ? "$backgroundBrand" : "$interactiveBaseErrorDefault"}
                      />
                    )}
                  </XStack>
                </XStack>
              </Pressable>
            </View>
            <Pressable
              hitSlop={20}
              onPress={() => {
                setStringAsync(release).catch(reportError);
                Alert.alert("Copied", "App version has been copied to the clipboard.");
              }}
            >
              <Text footnote color="$uiNeutralSecondary" textAlign="center">
                {release}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </SafeView>
  );
}
