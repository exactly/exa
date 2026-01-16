import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable } from "react-native";
import { SvgUri } from "react-native-svg";

import { useRouter } from "expo-router";

import { ArrowRight, Check, X } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Spinner, XStack, YStack } from "tamagui";

import { useMutation } from "@tanstack/react-query";

import SignatureCard from "../../assets/images/signature-full.svg";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { setCardStatus } from "../../utils/server";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

const scrollContentContainerStyle = { flexGrow: 1, paddingTop: 50 };

export default function VisaSignatureSheet({ open, onClose }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation();
  const toast = useToastController();
  const router = useRouter();

  const [acknowledged, setAcknowledged] = useState(true);

  const {
    mutateAsync: upgradeCard,
    isIdle,
    isError,
    isPending,
    isSuccess,
    reset,
  } = useMutation({
    mutationFn: setCardStatus,
    onSuccess: async () => {
      await queryClient.resetQueries({ queryKey: ["card", "details"] });
      toast.show(t("Card upgraded successfully"), {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "success" },
      });
    },
    onError: () => {
      toast.show(t("Error upgrading card"), {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
  });

  const onSuccess = useCallback(() => {
    reset();
    onClose();
    router.push("/card");
  }, [reset, onClose, router]);

  const close = useCallback(() => {
    if (isSuccess) {
      onSuccess();
      return;
    }
    onClose();
  }, [isSuccess, onSuccess, onClose]);
  return (
    <ModalSheet key={open ? "open" : "closed"} open={open} onClose={close} disableDrag heightPercent={90}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4" backgroundColor="black">
        <View position="absolute" top="$s5" right="$s5" zIndex={100_000}>
          <Pressable onPress={close} hitSlop={15}>
            <X size={25} color="$uiNeutralSecondary" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={scrollContentContainerStyle} $platform-web={{ maxHeight: "100vh" }}>
          <YStack
            flex={1}
            padding="$s5"
            gap="$s5"
            justifyContent={isSuccess || isIdle || isError ? "space-between" : "center"}
          >
            <View flex={1} justifyContent="center" alignItems="center">
              {isPending ? (
                <SvgUri
                  width="100%"
                  height="100%"
                  preserveAspectRatio="xMidYMid"
                  uri="https://assets.exactly.app/platinum-full.svg"
                />
              ) : (
                <SignatureCard
                  width="100%"
                  height="100%"
                  preserveAspectRatio="xMidYMid"
                  {...(Platform.OS === "web" ? undefined : { shouldRasterizeIOS: true })}
                />
              )}
            </View>
            {(isIdle || isError) && (
              <>
                <YStack flex={1} gap="$s5" alignItems="center" justifyContent="center">
                  <Text emphasized title color="white" textAlign="center">
                    {t("Level up your Exa Card")}
                  </Text>
                  <Text footnote color="white" textAlign="center">
                    {t("Move from Visa Platinum to Visa Signature and unlock premium benefits and perks.")}
                  </Text>
                </YStack>
                <YStack gap="$s5">
                  <YStack gap="$s4_5">
                    <XStack
                      cursor="pointer"
                      alignItems="center"
                      gap="$s4"
                      flex={1}
                      justifyContent="flex-start"
                      onPress={() => {
                        setAcknowledged(!acknowledged);
                      }}
                    >
                      <XStack cursor="pointer">
                        <View
                          width={16}
                          height={16}
                          backgroundColor={acknowledged ? "$backgroundBrand" : "transparent"}
                          borderColor="$backgroundBrand"
                          borderWidth={1}
                          borderRadius="$r2"
                          justifyContent="center"
                          alignItems="center"
                        >
                          {acknowledged && <Check size="$iconSize.xs" color="white" />}
                        </View>
                      </XStack>
                      <Text color="white" caption flex={1}>
                        {t(
                          "I understand that my current card will be deactivated. After the upgrade, I'll need to remove it from my digital wallet and add the new one.",
                        )}
                      </Text>
                    </XStack>
                    <Button
                      primary
                      loading={isPending}
                      disabled={!acknowledged || isPending}
                      onPress={() => {
                        if (!acknowledged) return;
                        upgradeCard("DELETED").catch(reportError);
                      }}
                    >
                      <Button.Text>{t("Upgrade Exa Card")}</Button.Text>
                      <Button.Icon>
                        <ArrowRight />
                      </Button.Icon>
                    </Button>
                  </YStack>
                  <Text onPress={close} color="$interactiveBaseBrandDefault" emphasized footnote alignSelf="center">
                    {t("I'll upgrade later")}
                  </Text>
                </YStack>
              </>
            )}
            {isPending && <Pending />}
            {isSuccess && <Success onPress={onSuccess} />}
          </YStack>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}

function Pending() {
  const { t } = useTranslation();
  return (
    <YStack flex={1} gap="$s5" alignItems="center">
      <Spinner color="white" size="large" width={40} height={40} />
      <Text emphasized title3 color="white" textAlign="center">
        {t("Deactivating current Exa Card")}
      </Text>
    </YStack>
  );
}

function Success({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <YStack flex={1} justifyContent="space-between" alignItems="center">
      <YStack gap="$s5" alignItems="center">
        <Check size={40} color="$backgroundBrand" />
        <YStack gap="$s3_5">
          <Text emphasized title3 color="white" textAlign="center">
            {t("Upgrade successful")}
          </Text>
          <Text footnote color="white" textAlign="center">
            {t("Your Exa Card is now upgraded to Visa Signature.")}
          </Text>
        </YStack>
      </YStack>
      <Button primary onPress={onPress}>
        <Button.Text>{t("Activate new Exa Card")}</Button.Text>
        <Button.Icon>
          <ArrowRight />
        </Button.Icon>
      </Button>
    </YStack>
  );
}
