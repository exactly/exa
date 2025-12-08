import { useQuery } from "@tanstack/react-query";
import React, { useState, useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";

import reportError from "../../utils/reportError";
import type { CardWithPIN } from "../../utils/server";
import Button from "../shared/Button";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function CardPIN({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [countdown, setCountdown] = useState(0);
  const [displayPIN, setDisplayPIN] = useState(false);
  const timerReference = React.useRef<NodeJS.Timeout>();
  const { data: card, isPending, error, refetch } = useQuery<CardWithPIN>({ queryKey: ["card", "pin"], enabled: open });

  function startCountdown() {
    setDisplayPIN(true);
    setCountdown(5);
    timerReference.current = setInterval(() => {
      setCountdown((previous) => {
        if (previous <= 1) {
          clearInterval(timerReference.current);
          setDisplayPIN(false);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
  }

  function stopCountdown() {
    clearInterval(timerReference.current);
    setDisplayPIN(false);
    setCountdown(0);
  }

  function handlePinToggle() {
    if (displayPIN) stopCountdown();
    else startCountdown();
  }

  useEffect(() => {
    if (open && card?.details.pin) startCountdown();
    else stopCountdown();
    return () => {
      clearInterval(timerReference.current);
    };
  }, [open, card]);
  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          <View fullScreen flex={1}>
            <View flex={1} padded>
              <YStack gap="$s4_5">
                <YStack gap="$s4">
                  <Text emphasized headline primary>
                    View Exa Card PIN number
                  </Text>
                  <Text color="$uiNeutralSecondary" subHeadline>
                    Your card&apos;s PIN may be required to confirm transactions and ensure security.
                  </Text>
                </YStack>
                {isPending || !card?.details.pin ? (
                  <Skeleton width="100%" height={100} />
                ) : (
                  <YStack gap="$s4">
                    {!error && card.details.pin ? (
                      <XStack flexWrap="wrap" justifyContent="center" gap="$s5">
                        {Array.from({ length: card.details.pin.length }).map((_, index) => (
                          <Text fontSize={48} fontFamily="$mono" key={index}>
                            {displayPIN ? card.details.pin[index] : "*"}
                          </Text>
                        ))}
                      </XStack>
                    ) : (
                      <Text fontSize={48} fontFamily="$mono">
                        N/A
                      </Text>
                    )}
                    <Button
                      main
                      spaced
                      onPress={() => {
                        if (error) {
                          refetch().catch(reportError);
                          return;
                        }
                        handlePinToggle();
                      }}
                    >
                      {error ? "Retry" : displayPIN ? "Hide PIN" : "Show PIN"}
                      {`${!error && displayPIN && countdown > 0 ? countdown : " "}`}
                    </Button>
                  </YStack>
                )}
                <Pressable onPress={onClose} style={styles.close} hitSlop={20}>
                  <Text emphasized footnote color="$interactiveTextBrandDefault">
                    Close
                  </Text>
                </Pressable>
              </YStack>
            </View>
          </View>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({ close: { alignSelf: "center" } });
