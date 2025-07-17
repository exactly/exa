import { Passkey } from "@exactly/common/validation";
import { Key } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { type FC, useCallback, useEffect, useRef, useState } from "react";
import type { StyleProp, ViewStyle, ViewToken } from "react-native";
import { Platform, Pressable } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";
import type { SvgProps } from "react-native-svg";
import { parse } from "valibot";
import { useConnect } from "wagmi";

import ListItem from "./ListItem";
import Pagination from "./Pagination";
import calendarBlob from "../../assets/images/calendar-blob.svg";
import calendar from "../../assets/images/calendar.svg";
import earningsBlob from "../../assets/images/earnings-blob.svg";
import earnings from "../../assets/images/earnings.svg";
import exaCardBlob from "../../assets/images/exa-card-blob.svg";
import exaCard from "../../assets/images/exa-card.svg";
import qrCodeBlob from "../../assets/images/qr-code-blob.svg";
import qrCode from "../../assets/images/qr-code.svg";
import alchemyConnector from "../../utils/alchemyConnector";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { APIError, getPasskey } from "../../utils/server";
import ActionButton from "../shared/ActionButton";
import ErrorDialog from "../shared/ErrorDialog";
import Text from "../shared/Text";
import View from "../shared/View";

export interface Page {
  title: string;
  image: FC<SvgProps>;
  backgroundImage: FC<SvgProps>;
  disabled?: boolean;
}

const containerStyle: StyleProp<ViewStyle> = {
  justifyContent: Platform.OS === "web" ? undefined : "center",
  alignItems: Platform.OS === "web" ? "stretch" : "center",
};

const pages: [Page, ...Page[]] = [
  {
    backgroundImage: exaCardBlob,
    image: exaCard,
    title: "Introducing the first onchain card",
  },
  {
    backgroundImage: calendarBlob,
    image: calendar,
    title: "Pay later in installments and hold your crypto",
  },
  {
    backgroundImage: earningsBlob,
    image: earnings,
    title: "Maximize earnings, effortlessly",
  },
  {
    backgroundImage: qrCodeBlob,
    disabled: true,
    image: qrCode,
    title: "In-store QR payments, with crypto",
  },
];

export default function Carousel() {
  const toast = useToastController();
  const [activeIndex, setActiveIndex] = useState(0);
  const { connect, isPending: isConnecting } = useConnect();
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);

  const flatListReference = useRef<Animated.FlatList<Page>>(null);
  const offsetX = useSharedValue(0);
  const progress = useSharedValue(0);

  const currentItem = pages[activeIndex] ?? pages[0];
  const { title, disabled } = currentItem;

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const newValue = viewableItems.length > 0 ? viewableItems[0]?.index : 0;
      setActiveIndex(newValue ?? 0);
      progress.value = 0;
    },
    [progress],
  );

  const handleScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      offsetX.value = event.contentOffset.x;
    },
  });

  const renderItem = useCallback(
    ({ item, index }: { item: Page; index: number }) => {
      return <ListItem item={item} index={index} x={offsetX} />;
    },
    [offsetX],
  );

  const scrollToNextPage = useCallback(() => {
    flatListReference.current?.scrollToIndex({
      index: activeIndex < pages.length - 1 ? activeIndex + 1 : 0,
      animated: true,
      viewPosition: 0.5,
    });
  }, [activeIndex]);

  const { mutate: recoverAccount, isPending } = useMutation({
    mutationFn: getPasskey,
    onError(error: unknown) {
      if (
        (error instanceof Error &&
          (error.message ===
            "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)" ||
            error.message === "The operation couldn’t be completed. Device must be unlocked to perform request." ||
            error.message === "UserCancelled" ||
            error.message.startsWith("androidx.credentials.exceptions.domerrors.NotAllowedError"))) ||
        (error instanceof APIError && error.text === "unauthorized")
      ) {
        toast.show("Authentication cancelled", {
          native: true,
          duration: 1000,
          burntOptions: { haptic: "error", preset: "error" },
        });
        return;
      }
      if (
        error instanceof Error &&
        error.message.startsWith("The operation couldn’t be completed. Application with identifier")
      ) {
        setErrorDialogOpen(true);
      }
      reportError(error);
    },
    onSuccess(passkey) {
      queryClient.setQueryData<Passkey>(["passkey"], parse(Passkey, passkey));
      connect({ connector: alchemyConnector });
      router.replace("/(app)/(home)");
    },
  });

  useEffect(() => {
    const timer = setInterval(() => {
      progress.value = withTiming(progress.value + 0.2, { duration: 1000, easing: Easing.linear }, () => {
        if (progress.value >= 1) {
          runOnJS(scrollToNextPage)();
          progress.value = 0;
        }
      });
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [activeIndex, progress, scrollToNextPage]);

  return (
    <View fullScreen>
      <View flexGrow={1} justifyContent="center" flexShrink={1}>
        <Animated.FlatList
          ref={flatListReference}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          data={pages}
          keyExtractor={(_, index) => index.toString()}
          viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
          renderItem={renderItem}
          onViewableItemsChanged={onViewableItemsChanged}
          horizontal
          onScrollToIndexFailed={() => undefined}
          pagingEnabled={Platform.OS !== "web"}
          bounces={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={containerStyle}
        />
      </View>
      <View
        padded
        flexGrow={1}
        flexDirection="column"
        alignSelf="stretch"
        alignItems="center"
        justifyContent="flex-end"
      >
        <View flexDirection="column" alignSelf="stretch" gap="$s5">
          <View flexDirection="row" justifyContent="center">
            <Pagination length={pages.length} x={offsetX} progress={progress} />
          </View>
          <View flexDirection="column" gap="$s5">
            <Text emphasized title brand centered>
              {title}
            </Text>
            <View height={20}>
              {disabled && (
                <Text
                  pill
                  emphasized
                  caption2
                  alignSelf="center"
                  backgroundColor="$interactiveBaseBrandDefault"
                  color="$interactiveOnBaseBrandDefault"
                >
                  COMING SOON
                </Text>
              )}
            </View>
          </View>
          <View alignItems="stretch" alignSelf="stretch" gap="$s5">
            <View flexDirection="row" alignSelf="stretch">
              <ActionButton
                flex={1}
                disabled={isPending || isConnecting}
                isLoading={isPending || isConnecting}
                loadingContent="Logging in..."
                onPress={() => {
                  if (isPending || isConnecting) return;
                  router.push("../onboarding/(passkeys)/passkeys");
                }}
                iconAfter={<Key color="$interactiveOnBaseBrandDefault" fontWeight="bold" />}
              >
                Create an account
              </ActionButton>
            </View>
            <View flexDirection="row" justifyContent="center">
              <Pressable
                hitSlop={15}
                onPress={() => {
                  if (isPending) return;
                  recoverAccount();
                }}
              >
                <Text fontSize={13} textAlign="center" color="$uiNeutralSecondary">
                  Already have an account?&nbsp;
                  <Text emphasized color="$interactiveBaseBrandDefault">
                    Log in
                  </Text>
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
      <ErrorDialog
        open={errorDialogOpen}
        title="Verification failed"
        description="Please check your internet connection and try again in a moment. If the problem persists, reinstalling the app may help."
        onClose={() => {
          setErrorDialogOpen(false);
        }}
      />
    </View>
  );
}
