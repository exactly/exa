import chain from "@exactly/common/generated/chain";
import { Copy } from "@tamagui/lucide-icons";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { AlertDialog, XStack, YStack } from "tamagui";

import OptimismImage from "../../assets/images/optimism.svg";
import useAspectRatio from "../../utils/useAspectRatio";
import Button from "./Button";
import Text from "./Text";
import View from "./View";

export default function AddressDialog({
  open,
  onActionPress,
  onClose,
}: {
  open: boolean;
  onActionPress: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const aspectRatio = useAspectRatio();
  return (
    <AlertDialog open={open}>
      <AlertDialog.Portal $platform-web={{ aspectRatio, justifySelf: "center" }}>
        <AlertDialog.Overlay
          onPress={onClose}
          key="overlay"
          backgroundColor="black"
          opacity={0.5}
          animation="quicker"
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <AlertDialog.Content
          $platform-web={{ backgroundColor: "transparent" }}
          key="content"
          animation={["quicker", { opacity: { overshootClamping: true } }]}
          enterStyle={{ x: 0, y: -20, opacity: 0, scale: 0.9 }}
          exitStyle={{ x: 0, y: 10, opacity: 0, scale: 0.95 }}
          x={0}
          y={0}
          scale={1}
          opacity={1}
          borderWidth={0}
          margin="$s5"
        >
          <YStack backgroundColor="$backgroundSoft" borderRadius="$r6" padding="$s5" paddingTop="$s5" gap="$s5">
            <XStack alignItems="center" gap="$s3" justifyContent="flex-start">
              <AlertDialog.Title>
                <Text emphasized headline>
                  {t("Network reminder")}
                </Text>
              </AlertDialog.Title>
            </XStack>
            <YStack gap="$s6">
              <YStack gap="$s5">
                <XStack gap="$s3" alignItems="center">
                  <View alignItems="center" justifyContent="center">
                    <OptimismImage height={32} width={32} />
                  </View>
                  <Text>
                    <Text emphasized title3>
                      {chain.name}
                    </Text>
                  </Text>
                </XStack>
                <Text secondary subHeadline>
                  <Trans
                    i18nKey="Add funds using <emphasis>{{network}}</emphasis> only. Sending assets on any other network will cause irreversible loss of funds."
                    values={{ network: chain.name }}
                    components={{ emphasis: <Text emphasized secondary /> }}
                  />
                </Text>
              </YStack>
              <XStack>
                <AlertDialog.Action asChild flex={1}>
                  <Button
                    onPress={onActionPress}
                    contained
                    main
                    spaced
                    fullwidth
                    iconAfter={<Copy strokeWidth={3} color="$interactiveOnBaseBrandDefault" />}
                  >
                    {t("Copy account address")}
                  </Button>
                </AlertDialog.Action>
              </XStack>
            </YStack>
          </YStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  );
}
