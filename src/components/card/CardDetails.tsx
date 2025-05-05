import { Copy } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { Skeleton } from "moti/skeleton";
import React, { useEffect, useState } from "react";
import { Appearance, Platform, Pressable, StyleSheet } from "react-native";
import { ScrollView, Sheet, XStack, YStack } from "tamagui";

import CardBack from "./CardBack";
import DismissableAlert from "./DismissableAlert";
import ExaLogoDark from "../../assets/images/exa-logo-dark.svg";
import ExaLogoLight from "../../assets/images/exa-logo-light.svg";
import VisaLogoDark from "../../assets/images/visa-logo-dark.svg";
import VisaLogoLight from "../../assets/images/visa-logo-light.svg";
import { decrypt } from "../../utils/panda";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getCard } from "../../utils/server";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function CardDetails({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: alertShown } = useQuery({ queryKey: ["settings", "alertShown"] });
  const toast = useToastController();
  const { data: card, isPending } = useQuery({ queryKey: ["card", "details"], queryFn: getCard });
  const [details, setDetails] = useState({ pan: "", cvc: "" });
  useEffect(() => {
    if (card && card.provider === "panda") {
      Promise.all([
        decrypt(card.encryptedPan.data, card.encryptedPan.iv, card.secret),
        decrypt(card.encryptedCvc.data, card.encryptedCvc.iv, card.secret),
      ])
        .then(([pan, cvc]) => {
          setDetails({ pan, cvc });
        })
        .catch(reportError);
    }
  }, [card]);
  return (
    <Sheet
      open={open}
      dismissOnSnapToBottom
      unmountChildrenWhenHidden
      forceRemoveScrollEnabled={open}
      animation="moderate"
      dismissOnOverlayPress
      onOpenChange={onClose}
      snapPointsMode="fit"
      zIndex={100_000}
      modal
      portalProps={Platform.OS === "web" ? { style: { aspectRatio: 10 / 16, justifySelf: "center" } } : undefined}
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
      />
      <Sheet.Frame>
        <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
          <ScrollView>
            <View fullScreen flex={1}>
              <View gap="$s5" flex={1} padded>
                {isPending ? (
                  <Skeleton height={200} width="100%" colorMode={Appearance.getColorScheme() ?? "light"} />
                ) : card ? (
                  card.provider === "panda" ? (
                    <YStack
                      borderRadius="$s3"
                      borderWidth={1}
                      borderColor="$borderNeutralSoft"
                      backgroundColor="$uiNeutralPrimary"
                      paddingHorizontal="$s5"
                      paddingTop="$s9"
                      paddingBottom="$s9"
                      justifyContent="space-between"
                      gap="$s4"
                    >
                      <View position="absolute" top="$s4" left="$s5">
                        {Appearance.getColorScheme() === "light" ? (
                          <ExaLogoLight height={20} width={63} />
                        ) : (
                          <ExaLogoDark height={20} width={63} />
                        )}
                      </View>
                      <View position="absolute" bottom="$s4" right="$s5">
                        {Appearance.getColorScheme() === "light" ? (
                          <VisaLogoLight height={40} width={72} />
                        ) : (
                          <VisaLogoDark height={40} width={72} />
                        )}
                      </View>
                      <XStack gap="$s4" alignItems="center" flexWrap="wrap">
                        <Text headline letterSpacing={2} fontFamily="$mono" color="$uiNeutralInversePrimary">
                          {details.pan.match(/.{1,4}/g)?.join(" ") ?? ""}
                        </Text>
                        <Copy
                          hitSlop={20}
                          size={16}
                          color="$uiNeutralInversePrimary"
                          strokeWidth={2.5}
                          onPress={() => {
                            setStringAsync(details.pan).catch(reportError);
                            toast.show("Copied to clipboard!");
                          }}
                        />
                      </XStack>
                      <XStack gap="$s5" alignItems="center" flexWrap="wrap">
                        <XStack alignItems="center" gap="$s3">
                          <Text caption color="$uiNeutralInverseSecondary">
                            Expires
                          </Text>
                          <Text headline letterSpacing={2} fontFamily="$mono" color="$uiNeutralInversePrimary">
                            {`${card.expirationMonth}/${card.expirationYear}`}
                          </Text>
                        </XStack>
                        <XStack alignItems="center" gap="$s3">
                          <Text caption color="$uiNeutralInverseSecondary">
                            CVV&nbsp;
                          </Text>
                          <Text headline letterSpacing={2} fontFamily="$mono" color="$uiNeutralInversePrimary">
                            {details.cvc}
                          </Text>
                        </XStack>
                      </XStack>
                      <YStack>
                        <Text emphasized headline letterSpacing={2} color="$uiNeutralInversePrimary">
                          {card.displayName}
                        </Text>
                      </YStack>
                    </YStack>
                  ) : (
                    <CardBack uri={card.url} />
                  )
                ) : null}
                {card && alertShown && (
                  <DismissableAlert
                    text="Manually add your card to Apple Pay & Google Pay to make contactless payments."
                    onDismiss={() => {
                      queryClient.setQueryData(["settings", "alertShown"], false);
                    }}
                  />
                )}
                <Pressable onPress={onClose} style={styles.close} hitSlop={20}>
                  <Text emphasized footnote color="$interactiveTextBrandDefault">
                    Close
                  </Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </SafeView>
      </Sheet.Frame>
    </Sheet>
  );
}

const styles = StyleSheet.create({ close: { alignSelf: "center" } });
