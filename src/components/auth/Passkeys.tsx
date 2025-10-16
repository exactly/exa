import { Key, X } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { XStack } from "tamagui";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import PasskeysBlob from "../../assets/images/passkeys-blob.svg";
import PasskeysImage from "../../assets/images/passkeys.svg";
import useAuth from "../../utils/useAuth";
import ActionButton from "../shared/ActionButton";
import ConnectSheet from "../shared/ConnectSheet";
import ErrorDialog from "../shared/ErrorDialog";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Passkeys() {
  const navigation = useNavigation<AppNavigationProperties>();
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const { data: isOwnerAvailable } = useQuery({ queryKey: ["is-owner-available"] });

  const { signIn, isPending: loading } = useAuth(
    () => {
      navigation.replace("(home)", { screen: "index" });
    },
    () => {
      setErrorDialogOpen(true);
    },
  );

  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View fullScreen padded>
        <View position="absolute" right="$s5" zIndex={1}>
          <Pressable
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.replace("(auth)");
              }
            }}
          >
            <X size={25} color="$uiNeutralSecondary" />
          </Pressable>
        </View>
        <View justifyContent="center" alignItems="center" flexGrow={1} flexShrink={1}>
          <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center" flexShrink={1}>
            <View width="100%" height="100%" aspectRatio={1}>
              <PasskeysBlob width="100%" height="100%" />
            </View>
            <View width="100%" height="100%" aspectRatio={1} style={StyleSheet.absoluteFill}>
              <PasskeysImage width="100%" height="100%" />
            </View>
          </View>
          <View gap="$s5" justifyContent="center">
            <Text emphasized title brand centered>
              A secure and easy way to access your account
            </Text>
            <Text fontSize={13} color="$uiNeutralSecondary" textAlign="center">
              To keep your account secure, Exa App uses passkeys, a passwordless authentication method protected by your
              device biometric verification.
            </Text>
          </View>
        </View>
        <View alignItems="stretch" alignSelf="stretch">
          <View flexDirection="row" alignSelf="stretch" justifyContent="center">
            <Text fontSize={11} color="$uiNeutralPlaceholder">
              By continuing, I accept the&nbsp;
            </Text>
            <Text fontSize={11} color="$interactiveBaseBrandDefault">
              Terms & Conditions
            </Text>
          </View>
          <View>
            <View flexDirection="row" alignSelf="stretch">
              <ActionButton
                flex={1}
                marginTop="$s4"
                marginBottom="$s5"
                isLoading={loading}
                loadingContent="Creating account..."
                iconAfter={
                  <Key
                    size={20}
                    color={loading ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandDefault"}
                    fontWeight="bold"
                  />
                }
                disabled={loading}
                onPress={() => {
                  if (loading) return;
                  signIn({ method: "webauthn", register: true });
                }}
              >
                Set passkey and create account
              </ActionButton>
            </View>
            <XStack justifyContent="center">
              <Text
                cursor="pointer"
                onPress={() => {
                  navigation.navigate("(passkeys)/about");
                }}
                textAlign="center"
                fontSize={13}
                fontWeight="bold"
                color="$interactiveBaseBrandDefault"
              >
                Learn more about passkeys
              </Text>
            </XStack>
          </View>
        </View>
      </View>
      <ErrorDialog
        open={errorDialogOpen}
        title="Verification failed"
        description="Please check your internet connection and try again in a moment. If the problem persists, reinstalling the app may help."
        onClose={() => {
          setErrorDialogOpen(false);
        }}
      />
      {isOwnerAvailable && (
        <ConnectSheet
          open={connectModalOpen}
          onClose={(method) => {
            setConnectModalOpen(false);
            if (!method) return;
            signIn({ method });
          }}
          title="Create account"
          description="Choose your preferred authentication method"
          webAuthnText="Sign up with Passkey"
          siweText="Sign up with browser wallet"
        />
      )}
    </SafeView>
  );
}
