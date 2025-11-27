import { ArrowRight, Check, X } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable } from "react-native";
import { SvgUri } from "react-native-svg";
import { ScrollView, Spinner, XStack, YStack } from "tamagui";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
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

export default function VisaSignatureSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToastController();
  const navigation = useNavigation<AppNavigationProperties>();

  const [acknowledged, setAcknowledged] = useState(false);

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
      toast.show("Card deactivated successfully", {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "success" },
      });
    },
    onError: () => {
      toast.show("Error upgrading card", {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
  });

  const handleUpgrade = useCallback(async () => {
    await upgradeCard("DELETED");
  }, [upgradeCard]);

  const handleSuccess = useCallback(() => {
    reset();
    onClose();
    navigation.navigate("(home)", { screen: "card" });
  }, [reset, onClose, navigation]);

  const handleClose = useCallback(() => {
    if (isSuccess) {
      handleSuccess();
      return;
    }
    onClose();
  }, [isSuccess, handleSuccess, onClose]);

  useEffect(() => {
    setAcknowledged(!open);
  }, [open, reset]);

  return (
    <ModalSheet open={open} onClose={handleClose} disableDrag heightPercent={90}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4" backgroundColor="black">
        <View position="absolute" top="$s5" right="$s5" zIndex={100_000}>
          <Pressable onPress={handleClose} hitSlop={15}>
            <X size={25} color="$uiNeutralSecondary" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={scrollContentContainerStyle} $platform-web={{ maxHeight: "100vh" }}>
          <YStack
            flex={1}
            padding="$s5"
            gap="$s5"
            paddingTop="$s7"
            justifyContent={isSuccess || isIdle || isError ? "space-between" : "center"}
          >
            <View flex={1.5} justifyContent="center" alignItems="center">
              {isPending ? (
                <SvgUri
                  width="100%"
                  height="100%"
                  preserveAspectRatio="xMidYMax"
                  uri="https://assets.exactly.app/platinum-full.svg"
                />
              ) : (
                <SignatureCard
                  width="100%"
                  height="100%"
                  preserveAspectRatio="xMidYMax"
                  {...(Platform.OS === "web" ? undefined : { shouldRasterizeIOS: true })}
                />
              )}
            </View>
            {(isIdle || isError) && (
              <>
                <YStack flex={1} gap="$s5" alignItems="center" justifyContent="center">
                  <Text emphasized title color="white">
                    Level up your Exa Card
                  </Text>
                  <Text footnote color="white" textAlign="center">
                    Move from Visa Platinum to Visa Signature and unlock premium benefits and perks.
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
                        I understand that my current card will be deactivated. After the upgrade, I&apos;ll need to
                        remove it from my digital wallet and add the new one.
                      </Text>
                    </XStack>
                    <Button
                      primary
                      loading={isPending}
                      disabled={!acknowledged || isPending}
                      onPress={() => {
                        if (!acknowledged) return;
                        handleUpgrade().catch(reportError);
                      }}
                    >
                      <Button.Text>Upgrade Exa Card</Button.Text>
                      <Button.Icon>
                        <ArrowRight />
                      </Button.Icon>
                    </Button>
                  </YStack>
                  <Text
                    onPress={handleClose}
                    color="$interactiveBaseBrandDefault"
                    emphasized
                    footnote
                    alignSelf="center"
                  >
                    I&apos;ll upgrade later
                  </Text>
                </YStack>
              </>
            )}
            {isPending && <Pending />}
            {isSuccess && <Success onPress={handleSuccess} />}
          </YStack>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}

function Pending() {
  return (
    <YStack flex={1} gap="$s5" alignItems="center">
      <Spinner color="white" size="large" width={40} height={40} />
      <Text emphasized title3 color="white" textAlign="center">
        Deactivating current Exa Card
      </Text>
    </YStack>
  );
}

function Success({ onPress }: { onPress: () => void }) {
  return (
    <YStack flex={1} justifyContent="space-between" alignItems="center">
      <YStack gap="$s5" alignItems="center">
        <Check size={40} color="$backgroundBrand" />
        <YStack gap="$s3_5">
          <Text emphasized title3 color="white" textAlign="center">
            Upgrade successful
          </Text>
          <Text footnote color="white" textAlign="center">
            Your Exa Card is now upgraded to Visa Signature.
          </Text>
        </YStack>
      </YStack>
      <Button primary onPress={onPress}>
        <Button.Text>Activate new Exa Card</Button.Text>
        <Button.Icon>
          <ArrowRight />
        </Button.Icon>
      </Button>
    </YStack>
  );
}
