import React from "react";
import { useTranslation } from "react-i18next";

import { YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";

import shortenHex from "@exactly/common/shortenHex";

import ModalSheet from "./ModalSheet";
import Button from "./StyledButton";
import Text from "./Text";
import logout from "../../utils/logout";
import reportError from "../../utils/reportError";
import useAuth from "../../utils/useAuth";
import ownerConfig from "../../utils/wagmi/owner";

import type { AuthMethod } from "../../utils/queryClient";
import type { Credential } from "@exactly/common/validation";

export default function WalletSwitchSheet() {
  const { t } = useTranslation();
  const { address } = useConnection({ config: ownerConfig });
  const { data: method } = useQuery<AuthMethod>({ queryKey: ["method"] });
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { signIn } = useAuth();
  const open =
    method === "siwe" && !!address && !!credential && address.toLowerCase() !== credential.credentialId.toLowerCase();
  return (
    <ModalSheet open={open} onClose={() => undefined} dismissible={false}>
      <YStack gap="s7" borderTopLeftRadius="r5" borderTopRightRadius="r5" backgroundColor="backgroundSoft">
        <YStack gap="s5" paddingTop="s7" paddingHorizontal="s5">
          <Text emphasized headline>
            {t("Your wallet changed")}
          </Text>
          <Text subHeadline color="uiNeutralSecondary">
            {t(
              "You logged in with {{session}}, but your wallet is now using {{wallet}}. Switch back to {{session}} in your wallet to keep using this account, or continue with {{wallet}}.",
              { session: shortenHex(credential?.credentialId ?? ""), wallet: shortenHex(address ?? "") },
            )}
          </Text>
        </YStack>
        <YStack paddingHorizontal="s5">
          <Button
            primary
            width="100%"
            onPress={() => {
              logout()
                .then(() => signIn({ method: "siwe" }))
                .catch(reportError);
            }}
          >
            <Button.Text>{t("Continue with {{wallet}}", { wallet: shortenHex(address ?? "") })}</Button.Text>
          </Button>
        </YStack>
      </YStack>
    </ModalSheet>
  );
}
