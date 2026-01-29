import React, { useCallback, useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { cancelAnimation, Easing, useSharedValue, withTiming } from "react-native-reanimated";
import Carousel from "react-native-reanimated-carousel";
import type { SvgProps } from "react-native-svg";

import { useRouter } from "expo-router";

import { Key, User } from "@tamagui/lucide-icons";
import { useWindowDimensions } from "tamagui";

import { sdk } from "@farcaster/miniapp-sdk";
import { TimeToFullDisplay } from "@sentry/react-native";
import { useQuery } from "@tanstack/react-query";

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
import reportError from "../../utils/reportError";
import useAspectRatio from "../../utils/useAspectRatio";
import useAuth from "../../utils/useAuth";
import ConnectSheet from "../shared/ConnectSheet";
import ErrorDialog from "../shared/ErrorDialog";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { EmbeddingContext } from "../../utils/queryClient";

function renderItem({ item, animationValue }: { animationValue: SharedValue<number>; item: Page }) {
  return <ListItem item={item} animationValue={animationValue} />;
}

export default function Auth() {
  const router = useRouter();
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [signUpModalOpen, setSignUpModalOpen] = useState(false);
  const [signInModalOpen, setSignInModalOpen] = useState(false);

  const progress = useSharedValue(0);
  const scrollOffset = useSharedValue(0);
  const isScrolling = useSharedValue(false);

  const { width, height } = useWindowDimensions();
  const aspectRatio = useAspectRatio();
  const itemWidth = Math.max(Platform.OS === "web" ? height * aspectRatio : width, 250);

  const currentItem = pages[activeIndex] ?? pages[0];
  const { title, disabled } = currentItem;

  const { data: isMiniApp } = useQuery({ queryKey: ["is-miniapp"] });
  const { data: isOwnerAvailable } = useQuery({ queryKey: ["is-owner-available"] });
  const { data: embeddingContext, isPending: loadingContext } = useQuery<EmbeddingContext>({
    queryKey: ["embedding-context"],
  });

  const startProgressAnimation = useCallback(() => {
    progress.value = 0;
    progress.value = withTiming(1, { duration: 5000, easing: Easing.linear });
  }, [progress]);

  const handleSnapToItem = useCallback((index: number) => setActiveIndex(index), []);

  const handleScrollEnd = useCallback(() => {
    isScrolling.value = false;
    startProgressAnimation();
  }, [isScrolling, startProgressAnimation]);

  const handleProgressChange = useCallback(
    (_: number, absoluteProgress: number) => {
      const previousOffset = scrollOffset.value;
      const delta = Math.abs(absoluteProgress - previousOffset);
      scrollOffset.value = absoluteProgress;

      const nearestIndex = Math.round(absoluteProgress);
      const distanceFromRest = Math.abs(absoluteProgress - nearestIndex);
      const scrolling = distanceFromRest > 0.01 && delta > 0.001;

      if (scrolling && !isScrolling.value) {
        isScrolling.value = true;
        cancelAnimation(progress);
        progress.value = 0;
      }
    },
    [scrollOffset, isScrolling, progress],
  );

  useEffect(() => {
    startProgressAnimation();
  }, [startProgressAnimation]);

  const { signIn, isPending: loadingAuth } = useAuth(
    () => {
      setErrorDialogOpen(true);
    },
    () => {
      if (isMiniApp) sdk.actions.addMiniApp().catch(reportError);
    },
  );

  const loading = loadingAuth || loadingContext;

  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View flexGrow={1} justifyContent="center" flexShrink={1}>
        <Carousel
          data={pages}
          width={itemWidth}
          height={itemWidth / aspectRatio}
          autoPlay
          autoPlayInterval={5000}
          scrollAnimationDuration={500}
          onSnapToItem={handleSnapToItem}
          onScrollEnd={handleScrollEnd}
          onProgressChange={handleProgressChange}
          renderItem={renderItem}
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
            <Pagination
              length={pages.length}
              scrollOffset={scrollOffset}
              progress={progress}
              isScrolling={isScrolling}
            />
          </View>
          <View flexDirection="column" gap="$s5">
            <Text emphasized title brand centered>
              {t(title)}
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
                  {t("COMING SOON")}
                </Text>
              )}
            </View>
          </View>
          <View alignItems="stretch" alignSelf="stretch" gap="$s3">
            <View flexDirection="row" alignSelf="stretch">
              <Button
                primary
                loading={loading}
                disabled={loading}
                flex={1}
                alignItems="center"
                onPress={() => {
                  if (loading) return;
                  if (embeddingContext) {
                    signIn({ method: "siwe" });
                    return;
                  }
                  if (isOwnerAvailable) {
                    setSignUpModalOpen(true);
                  } else {
                    router.push("/passkeys");
                  }
                }}
              >
                <Button.Text>
                  {loading ? t("Please wait...") : embeddingContext ? t("Sign in") : t("Create new account")}
                </Button.Text>
                <Button.Icon>
                  <Key />
                </Button.Icon>
              </Button>
            </View>
            <View flexDirection="row" justifyContent="center">
              {!embeddingContext && (
                <Button
                  transparent
                  disabled={loading}
                  flex={1}
                  alignItems="center"
                  hitSlop={15}
                  onPress={() => {
                    if (loading) return;
                    if (isOwnerAvailable) setSignInModalOpen(true);
                    else signIn({ method: "webauthn" });
                  }}
                >
                  <Button.Text>{t("I already have an account")}</Button.Text>
                  <Button.Icon>
                    <User />
                  </Button.Icon>
                </Button>
              )}
            </View>
          </View>
        </View>
      </View>
      <ErrorDialog
        open={errorDialogOpen}
        title={t("Verification failed")}
        description={t(
          "Please check your internet connection and try again in a moment. If the problem persists, reinstalling the app may help.",
        )}
        onClose={() => {
          setErrorDialogOpen(false);
        }}
      />
      {isOwnerAvailable ? (
        <>
          <ConnectSheet
            open={signInModalOpen}
            onClose={(method) => {
              setSignInModalOpen(false);
              if (!method) return;
              signIn({ method });
            }}
            title={t("Log in")}
            description={t("Choose your preferred authentication method")}
            webAuthnText={t("Log in with Passkey")}
            siweText={t("Log in with browser wallet")}
          />
          <ConnectSheet
            open={signUpModalOpen}
            onClose={(method) => {
              setSignUpModalOpen(false);
              if (!method) return;
              if (method === "webauthn") {
                setSignUpModalOpen(false);
                router.push("/passkeys");
                return;
              }
              signIn({ method });
            }}
            title={t("Create account")}
            description={t("Choose your preferred authentication method")}
            webAuthnText={t("Sign up with Passkey")}
            siweText={t("Sign up with browser wallet")}
          />
        </>
      ) : null}
      <TimeToFullDisplay record />
    </SafeView>
  );
}

export type Page = {
  backgroundImage: FC<SvgProps>;
  disabled?: boolean;
  image: FC<SvgProps>;
  title: string;
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
