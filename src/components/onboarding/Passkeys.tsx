import type { Passkey } from "@exactly/common/validation";
import { Key, X } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useConnect } from "wagmi";

import PasskeysBlob from "../../assets/images/passkeys-blob.svg";
import PasskeysImage from "../../assets/images/passkeys.svg";
import alchemyConnector from "../../utils/alchemyConnector";
import reportError from "../../utils/reportError";
import { APIError, createCredential } from "../../utils/server";
import ActionButton from "../shared/ActionButton";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

function close() {
  router.back();
}

function learnMore() {
  router.push("../(passkeys)/about");
}

export default function Passkeys() {
  const queryClient = useQueryClient();
  const toast = useToastController();

  const {
    mutate: createAccount,
    isSuccess,
    isPending,
  } = useMutation<Passkey>({
    mutationFn: createCredential,
    onError(error: unknown) {
      if (
        error instanceof Error &&
        (error.message ===
          "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)" ||
          error.message === "The operation couldn’t be completed. Device must be unlocked to perform request." ||
          error.message === "UserCancelled" ||
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
      reportError(error);
    },
    onSuccess(passkey) {
      queryClient.setQueryData<Passkey>(["passkey"], passkey);
    },
  });

  const { connect, isPending: isConnecting } = useConnect();

  const { data } = useQuery<Passkey>({ queryKey: ["passkey"] });

  useEffect(() => {
    if (isSuccess && data?.credentialId) {
      connect({ connector: alchemyConnector });
      router.replace("../success");
    }
  }, [connect, data, isSuccess]);

  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View fullScreen padded>
        <View position="absolute" right="$s5" zIndex={1}>
          <Pressable onPress={close}>
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
              {`By continuing, I accept the `}
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
                isLoading={isPending || isConnecting}
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
                  createAccount();
                }}
              >
                Set passkey and create account
              </ActionButton>
            </View>
            <View flexDirection="row" justifyContent="center">
              <Pressable onPress={learnMore}>
                <Text textAlign="center" fontSize={13} fontWeight="bold" color="$interactiveBaseBrandDefault">
                  Learn more about passkeys
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </SafeView>
  );
}
