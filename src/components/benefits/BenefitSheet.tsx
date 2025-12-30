import { sdk } from "@farcaster/miniapp-sdk";
import { Copy, ExternalLink, X } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import React, { useCallback } from "react";
import { Platform, Pressable, ScrollView } from "react-native";
import { YStack, XStack, Spinner } from "tamagui";

import type { Benefit } from "./BenefitsSection";
import queryClient, { type EmbeddingContext } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import type { PaxId } from "../../utils/server";
import useOpenBrowser from "../../utils/useOpenBrowser";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

interface BenefitSheetProperties {
  benefit: Benefit | undefined;
  open: boolean;
  onClose: () => void;
}

export default function BenefitSheet({ benefit, open, onClose }: BenefitSheetProperties) {
  const toast = useToastController();
  const openBrowser = useOpenBrowser();

  const { data: paxData } = useQuery<PaxId>({
    queryKey: ["pax", "id"],
    enabled: benefit?.id === "pax" && open,
  });

  const handleOpenUrl = useCallback(
    async (url: string) => {
      if (Platform.OS === "web") {
        if (await sdk.isInMiniApp()) {
          await sdk.actions.openUrl(url);
          return;
        }
        const embeddingContext = queryClient.getQueryData<EmbeddingContext>(["embedding-context"]);
        if (embeddingContext && !embeddingContext.endsWith("-web")) {
          window.location.replace(url);
          return;
        }
        window.open(url);
        return;
      }

      openBrowser(url).catch(reportError);
    },
    [openBrowser],
  );

  if (!benefit) return null;

  const LogoComponent = benefit.logo;

  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView
        paddingTop={0}
        $platform-web={{ paddingBottom: "$s4" }}
        fullScreen
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
      >
        <View position="absolute" top="$s5" right="$s5" zIndex={100_000}>
          <Pressable onPress={onClose} hitSlop={15}>
            <X size={25} color="$uiNeutralSecondary" />
          </Pressable>
        </View>
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          <YStack gap="$s3" paddingHorizontal="$s5" paddingVertical="$s7">
            <YStack gap="$s3" paddingBottom="$s4">
              <XStack alignItems="center" gap="$s3">
                <LogoComponent width={32} height={32} />
                <Text emphasized title3>
                  {benefit.partner}
                </Text>
              </XStack>

              <Text emphasized title>
                {benefit.longTitle ?? benefit.title}
              </Text>
              <Text subHeadline secondary>
                {benefit.description}
              </Text>

              {benefit.id === "pax" && (
                <Pressable
                  disabled={!paxData}
                  onPress={() => {
                    if (paxData) {
                      setStringAsync(paxData.associateId).catch(reportError);
                      toast.show("pax id copied!", {
                        native: true,
                        duration: 1000,
                        burntOptions: { haptic: "success" },
                      });
                    }
                  }}
                >
                  <XStack
                    backgroundColor="$backgroundMild"
                    borderRadius="$3"
                    padding="$s4"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    {paxData ? (
                      <Text emphasized body>
                        {paxData.associateId}
                      </Text>
                    ) : (
                      <Spinner color="$uiNeutralSecondary" />
                    )}
                    <XStack
                      alignItems="center"
                      gap="$s1"
                      backgroundColor="$interactiveBaseSuccessDefault"
                      paddingHorizontal="$s3"
                      paddingVertical="$s2"
                    >
                      <Text caption2 color="$interactiveOnBaseSuccessDefault">
                        COPY ID
                      </Text>
                      <Copy size={16} color="$interactiveOnBaseSuccessDefault" />
                    </XStack>
                  </XStack>
                </Pressable>
              )}
            </YStack>
            <Button
              backgroundColor="$interactiveBaseBrandDefault"
              justifyContent="space-between"
              minHeight={64}
              padding="$s4"
              onPress={() => {
                (async () => {
                  let url = benefit.url;
                  if (benefit.id === "pax" && paxData?.associateId) {
                    url = `${benefit.url}?cid=${paxData.associateId}`;
                  }
                  await handleOpenUrl(url);
                })().catch(reportError);
              }}
            >
              <Button.Text emphasized subHeadline color="white">
                {benefit.buttonText ?? "Get benefit"}
              </Button.Text>
              <ExternalLink size={20} color="white" />
            </Button>

            {benefit.termsUrl && (
              <Button
                flex={1}
                transparent
                justifyContent="center"
                onPress={() => {
                  if (!benefit.termsUrl) return;
                  handleOpenUrl(benefit.termsUrl).catch(reportError);
                }}
              >
                <Button.Text emphasized footnote textAlign="center">
                  Terms & conditions
                </Button.Text>
              </Button>
            )}
          </YStack>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}
