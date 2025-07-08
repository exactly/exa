import { Key, X } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable, StyleSheet } from "react-native";
import { XStack } from "tamagui";

import PasskeysBlob from "../../assets/images/passkeys-blob.svg";
import PasskeysImage from "../../assets/images/passkeys.svg";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import useAuth from "../../utils/useAuth";
import ActionButton from "../shared/ActionButton";
import ConnectSheet from "../shared/ConnectSheet";
import ErrorDialog from "../shared/ErrorDialog";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Passkeys() {
  const router = useRouter();
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const { data: isOwnerAvailable } = useQuery({ queryKey: ["is-owner-available"] });
  const { t } = useTranslation();

  const { signIn, isPending: loading } = useAuth(() => {
    setErrorDialogOpen(true);
  });

  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View fullScreen padded>
        <View position="absolute" right="$s5" zIndex={1}>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(auth)");
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
              {t("A secure and easy way to access your account")}
            </Text>
            <Text fontSize={13} color="$uiNeutralSecondary" textAlign="center">
              {t(
                "To keep your account secure, Exa App uses passkeys, a passwordless authentication method protected by your device biometric verification.",
              )}
            </Text>
          </View>
        </View>
        <View alignItems="stretch" alignSelf="stretch">
          <View flexDirection="row" alignSelf="stretch" justifyContent="center">
            <Text fontSize={11} color="$uiNeutralPlaceholder">
              <Trans
                i18nKey="By continuing, I accept the <terms>Terms & Conditions</terms>"
                components={{
                  terms: (
                    <Text
                      fontSize={11}
                      color="$interactiveBaseBrandDefault"
                      onPress={() => {
                        openBrowser(
                          "https://intercom.help/exa-app/en/articles/9942510-exa-app-terms-and-conditions",
                        ).catch(reportError);
                      }}
                    />
                  ),
                }}
              />
            </Text>
          </View>
          <View>
            <View flexDirection="row" alignSelf="stretch">
              <ActionButton
                flex={1}
                marginTop="$s4"
                marginBottom="$s5"
                isLoading={loading}
                loadingContent={t("Creating account...")}
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
                {t("Set passkey and create account")}
              </ActionButton>
            </View>
            <XStack justifyContent="center">
              <Text
                cursor="pointer"
                onPress={() => {
                  router.push("/(auth)/(passkeys)/about");
                }}
                textAlign="center"
                fontSize={13}
                fontWeight="bold"
                color="$interactiveBaseBrandDefault"
              >
                {t("Learn more about passkeys")}
              </Text>
            </XStack>
          </View>
        </View>
      </View>
      <ErrorDialog
        open={errorDialogOpen}
        title={t("Verification failed")}
        description={t(
          "Please check your internet connection and try again in a moment. If the problem persists, reinstalling the app may help.",
        )}
        onClose={() => {
          setErrorDialogOpen(false);
        }}
      />
      {isOwnerAvailable ? (
        <ConnectSheet
          open={connectModalOpen}
          onClose={(method) => {
            setConnectModalOpen(false);
            if (!method) return;
            signIn({ method });
          }}
          title={t("Create account")}
          description={t("Choose your preferred authentication method")}
          webAuthnText={t("Sign up with Passkey")}
          siweText={t("Sign up with browser wallet")}
        />
      ) : null}
    </SafeView>
  );
}
