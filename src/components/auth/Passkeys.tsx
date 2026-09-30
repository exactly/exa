import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { Key, X } from "@tamagui/lucide-icons-2";
import { XStack } from "tamagui";

import passkeys from "../../assets/images/passkeys.webp";
import { loginUnidentified, present } from "../../utils/intercom";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import useAuth from "../../utils/useAuth";
import ErrorDialog from "../shared/ErrorDialog";
import IconButton from "../shared/IconButton";
import Image from "../shared/Image";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Passkeys() {
  const router = useRouter();
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const { t } = useTranslation();

  const { signIn, isPending: loading } = useAuth(() => {
    setErrorDialogOpen(true);
  });

  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View fullScreen padded>
        <View position="absolute" right="$s5" zIndex={1}>
          <IconButton
            icon={X}
            size={25}
            color="$uiNeutralSecondary"
            aria-label={t("Close")}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(auth)");
              }
            }}
          />
        </View>
        <View justifyContent="center" alignItems="center" flexGrow={1} flexShrink={1}>
          <Image
            source={passkeys}
            contentFit="contain"
            width="100%"
            aspectRatio={1}
            flexShrink={1}
            paddingHorizontal="$s5"
          />
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
              <Button
                primary
                flex={1}
                marginTop="$s4"
                marginBottom="$s5"
                loading={loading}
                disabled={loading}
                onPress={() => {
                  if (loading) return;
                  signIn({ method: "webauthn", register: true });
                }}
              >
                <Button.Text>{loading ? t("Creating account...") : t("Set passkey and create account")}</Button.Text>
                <Button.Icon>
                  <Key />
                </Button.Icon>
              </Button>
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
        onContact={() => {
          setErrorDialogOpen(false);
          loginUnidentified().then(present).catch(reportError);
        }}
      />
    </SafeView>
  );
}
