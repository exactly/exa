import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useState, useRef } from "react";
import { Pressable } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";

import reportError from "../../utils/reportError";
import type { CardWithPIN } from "../../utils/server";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function CardPIN({ open, onClose }: { open: boolean; onClose: () => void }) {
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
                    View Exa Card PIN number
                  </Text>
                  <Text color="$uiNeutralSecondary" subHeadline>
                    Your card&apos;s PIN may be required to confirm transactions and ensure security.
                  </Text>
                </YStack>
                {isPending || !card ? (
                  <Skeleton width="100%" height={100} />
                ) : (
                  <PinDisplay
                    key={open ? "open" : "closed"}
                    pin={card.details.pin}
                    error={error}
                    refetch={() => {
                      refetch().catch(reportError);
                    }}
                    onClose={onClose}
                  />
                )}
              </YStack>
            </View>
          </View>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}

function PinDisplay({
  pin,
  error,
  refetch,
  onClose,
}: {
  pin: string;
  error: Error | null;
  refetch: () => void;
  onClose: () => void;
}) {
  const [isHidden, setIsHidden] = useState(false);
  const [timeLeft, setTimeLeft] = useState(5);
  const intervalId = useRef<NodeJS.Timeout | null>(null);
  const showPIN = !!pin && !isHidden;

  useEffect(() => {
    if (!showPIN) return;
    intervalId.current = setInterval(() => {
      setTimeLeft((previous) => {
        if (previous <= 1) {
          if (intervalId.current) clearInterval(intervalId.current);
          setIsHidden(true);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
    return () => {
      if (intervalId.current) clearInterval(intervalId.current);
    };
  }, [showPIN]);

  return (
    <YStack gap="$s4">
      {error ? (
        <Text fontSize={48} fontFamily="$mono">
          N/A
        </Text>
      ) : (
        <XStack flexWrap="wrap" justifyContent="center" gap="$s5">
          {Array.from({ length: pin.length }).map((_, index) => (
            // eslint-disable-next-line @eslint-react/no-array-index-key
            <Text key={index} fontSize={48} fontFamily="$mono">
              {showPIN ? pin[index] : "*"}
            </Text>
          ))}
        </XStack>
      )}
      <Button
        primary
        dangerSecondary={!!error}
        onPress={() => {
          if (error) refetch();
          if (showPIN) {
            setIsHidden(true);
          } else {
            setTimeLeft(5);
            setIsHidden(false);
          }
        }}
      >
        <Button.Text textAlign="left">{error ? "Retry" : showPIN ? `Hide PIN` : "Show PIN"}</Button.Text>
        <Button.Text textAlign="right">{showPIN && timeLeft > 0 && String(timeLeft)}</Button.Text>
      </Button>
      <Pressable onPress={onClose} style={{ alignSelf: "center" }} hitSlop={20}>
        <Text emphasized footnote color="$interactiveTextBrandDefault">
          Close
        </Text>
      </Pressable>
    </YStack>
  );
}
