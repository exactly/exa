import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
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
  const { t } = useTranslation();
  const { data: card, isPending, error, refetch } = useQuery<CardWithPIN>({ queryKey: ["card", "pin"], enabled: open });
  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          <View fullScreen flex={1}>
            <View flex={1} padded>
              <YStack gap="$s4_5">
                <YStack gap="$s4">
                  <Text emphasized headline primary>
                    {t("View Exa Card PIN number")}
                  </Text>
                  <Text color="$uiNeutralSecondary" subHeadline>
                    {t("Your card’s PIN may be required to confirm transactions and ensure security.")}
                  </Text>
                </YStack>
                {isPending ? (
                  <Skeleton width="100%" height={100} />
                ) : (
                  <Countdown
                    pin={card?.details.pin}
                    error={error}
                    onRetry={() => {
                      refetch().catch(reportError);
                    }}
                  />
                )}
                <XStack alignSelf="center">
                  <Pressable onPress={onClose} hitSlop={20}>
                    <Text emphasized footnote color="$interactiveTextBrandDefault">
                      {t("Close")}
                    </Text>
                  </Pressable>
                </XStack>
              </YStack>
            </View>
          </View>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}

function Countdown({ pin, error, onRetry }: { pin?: string; error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const [displayPIN, setDisplayPIN] = useState(true);
  const [countdown, setCountdown] = useState(5);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  function startTimer() {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((previous) => {
        if (previous <= 1) {
          clearInterval(timerRef.current);
          setDisplayPIN(false);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    startTimer();
    return () => {
      clearInterval(timerRef.current);
    };
  }, []);

  function handleToggle() {
    if (displayPIN) {
      clearInterval(timerRef.current);
      setDisplayPIN(false);
      setCountdown(0);
    } else {
      setDisplayPIN(true);
      setCountdown(5);
      startTimer();
    }
  }

  return (
    <YStack gap="$s4">
      {!error && pin ? (
        <XStack flexWrap="wrap" justifyContent="center" gap="$s5">
          {Array.from({ length: pin.length }).map((_, index) => (
            // eslint-disable-next-line @eslint-react/no-array-index-key
            <Text fontSize={48} fontFamily="$mono" key={index}>
              {displayPIN ? pin[index] : "*"}
            </Text>
          ))}
        </XStack>
      ) : (
        <Text fontSize={48} fontFamily="$mono">
          {t("N/A")}
        </Text>
      )}
      <Button
        main
        spaced
        onPress={() => {
          if (error) {
            onRetry();
            return;
          }
          handleToggle();
        }}
      >
        {error ? t("Retry") : displayPIN ? t("Hide PIN") : t("Show PIN")}
        {`${!error && displayPIN && countdown > 0 ? countdown : " "}`}
      </Button>
    </YStack>
  );
}
