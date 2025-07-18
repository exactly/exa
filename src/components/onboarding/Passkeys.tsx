import type { Credential } from "@exactly/common/validation";
import { Key, X } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { XStack } from "tamagui";
import { useConnect } from "wagmi";

import PasskeysBlob from "../../assets/images/passkeys-blob.svg";
import PasskeysImage from "../../assets/images/passkeys.svg";
import alchemyConnector from "../../utils/alchemyConnector";
import reportError from "../../utils/reportError";
import { APIError, createCredential } from "../../utils/server";
import ActionButton from "../shared/ActionButton";
import ConnectSheet from "../shared/ConnectSheet";
import ErrorDialog from "../shared/ErrorDialog";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Passkeys() {
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { connect } = useConnect();
  const toast = useToastController();
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  const { mutate: createAccount, isPending } = useMutation({
    mutationFn: createCredential,
    onError(error: unknown) {
      if (
        error instanceof Error &&
        (error.message ===
          "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)" ||
          error.message === "The operation couldn’t be completed. Device must be unlocked to perform request." ||
          error.message === "UserCancelled" ||
          error.name === "NotAllowedError" ||
          error.message.startsWith("androidx.credentials.exceptions.domerrors.NotAllowedError"))
      ) {
        toast.show("Operation cancelled", {
          native: true,
          duration: 1000,
          burntOptions: { haptic: "error", preset: "error" },
        });
        return;
      }
      if (error instanceof APIError && error.text === "backup eligibility required") {
        toast.show("Your password manager does not support passkey backups. Please try a different one", {
          native: true,
          duration: 1000,
          burntOptions: { haptic: "error", preset: "error" },
        });
        return;
      }
      if (
        error instanceof Error &&
        error.message.startsWith("The operation couldn’t be completed. Application with identifier")
      ) {
        setErrorDialogOpen(true);
      }
      reportError(error);
    },
    onSuccess(credential) {
      connect({ connector: alchemyConnector });
      queryClient.setQueryData<Credential>(["credential"], credential);
      router.replace("../success");
    },
  });
  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View fullScreen padded>
        <View position="absolute" right="$s5" zIndex={1}>
          <Pressable
            onPress={() => {
              router.back();
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
                isLoading={isPending}
                loadingContent="Creating account..."
                iconAfter={
                  <Key
                    size={20}
                    color={isPending ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandDefault"}
                    fontWeight="bold"
                  />
                }
                disabled={isPending}
                onPress={() => {
                  setConnectModalOpen(true);
                }}
              >
                Set passkey and create account
              </ActionButton>
            </View>
            <XStack justifyContent="center">
              <Text
                cursor="pointer"
                onPress={() => {
                  router.push("../(passkeys)/about");
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
      <ConnectSheet
        open={connectModalOpen}
        onClose={(method) => {
          setConnectModalOpen(false);
          if (method === "webauthn") createAccount();
        }}
        title="Create account"
        description="Choose your preferred authentication method"
        webAuthnText="Sign up with Passkey"
        siweText="Sign up with browser wallet"
      />
    </SafeView>
  );
}
