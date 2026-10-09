import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { cancelAnimation, Easing, useSharedValue, withTiming } from "react-native-reanimated";
import Carousel from "react-native-reanimated-carousel";

import { useRouter } from "expo-router";

import { Headphones, LogIn, UserPlus } from "@tamagui/lucide-icons-2";
import { useWindowDimensions } from "tamagui";

import { sdk } from "@farcaster/miniapp-sdk";
import { TimeToFullDisplay } from "@sentry/react-native";
import { useQuery } from "@tanstack/react-query";

import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";

import ListItem from "./ListItem";
import Pagination from "./Pagination";
import calendar from "../../assets/images/calendar.webp";
import creditCard from "../../assets/images/credit-card.webp";
import earnArrow from "../../assets/images/earn-arrow.webp";
import { loginUnidentified, present } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useAspectRatio from "../../utils/useAspectRatio";
import useAuth from "../../utils/useAuth";
import ConnectSheet from "../shared/ConnectSheet";
import ErrorDialog from "../shared/ErrorDialog";
import IconButton from "../shared/IconButton";
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
  const { t, i18n } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [signUpModalOpen, setSignUpModalOpen] = useState(false);
  const [signInModalOpen, setSignInModalOpen] = useState(false);

  const progress = useSharedValue(0);
  const scrollOffset = useSharedValue(0);
  const isScrolling = useSharedValue(false);

  const { width, height, fontScale } = useWindowDimensions();
  const aspectRatio = useAspectRatio();
  const itemWidth = Math.max(Platform.OS === "web" ? height * aspectRatio : width, 250);

  const currentItem = pages[activeIndex] ?? pages[0];
  const layout = `${width}:${fontScale}:${i18n.language}`;
  const [title, setTitle] = useState({ fits: {}, layout, size: 30 });
  if (title.layout !== layout) setTitle({ fits: {}, layout, size: 30 });
  const [subtitles, setSubtitles] = useState<Record<string, number>>({});
  const [stage, setStage] = useState<number>();
  const measured = Object.keys(title.fits).length === pages.length && Object.keys(subtitles).length === pages.length;

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
      {!loadingContext && !embeddingContext && (
        <View padded paddingBottom={0} flexDirection="row" justifyContent="flex-end" alignSelf="stretch" zIndex={1}>
          <IconButton
            icon={Headphones}
            color="$uiNeutralSecondary"
            aria-label={t("Contact support")}
            onPress={() => {
              loginUnidentified().then(present).catch(reportError);
            }}
          />
        </View>
      )}
      <View flex={1} overflow="hidden" onLayout={({ nativeEvent }) => setStage(nativeEvent.layout.height)}>
        {stage !== undefined && (
          <Carousel
            data={pages}
            width={itemWidth}
            height={stage}
            autoPlay
            autoPlayInterval={5000}
            withAnimation={{ type: "timing", config: { duration: 512, easing: Easing.bezier(0.7, 0, 0.3, 1) } }}
            onSnapToItem={handleSnapToItem}
            onScrollEnd={handleScrollEnd}
            onProgressChange={handleProgressChange}
            renderItem={renderItem}
          />
        )}
      </View>
      <View padded flexDirection="column" alignSelf="stretch" alignItems="center" justifyContent="flex-end">
        <View flexDirection="column" alignSelf="stretch" gap="$s6">
          <View flexDirection="row" justifyContent="center">
            <Pagination
              length={pages.length}
              scrollOffset={scrollOffset}
              progress={progress}
              isScrolling={isScrolling}
            />
          </View>
          <View gap="$s3" paddingHorizontal="$s5" opacity={measured ? 1 : 0}>
            <View>
              {pages.map((page) => (
                <Text
                  key={`${title.layout}:${page.title}`}
                  emphasized
                  title
                  centered
                  fontSize={title.size}
                  lineHeight={title.size * 1.3}
                  position="absolute"
                  left={0}
                  right={0}
                  opacity={0}
                  pointerEvents="none"
                  aria-hidden
                  onLayout={({ nativeEvent }) => {
                    const fits = nativeEvent.layout.height <= title.size * 2.6 * fontScale + 1;
                    setTitle((previous) => {
                      if (previous.size !== title.size || previous.layout !== title.layout) return previous;
                      if (!fits && previous.size > 20) return { ...previous, fits: {}, size: previous.size - 1 };
                      return { ...previous, fits: { ...previous.fits, [page.title]: fits } };
                    });
                  }}
                >
                  {t(page.title)}
                </Text>
              ))}
              <Text
                emphasized
                title
                centered
                fontSize={title.size}
                lineHeight={title.size * 1.3}
                height={Object.values(title.fits).every(Boolean) ? title.size * 2.6 * fontScale : undefined}
              >
                {t(currentItem.title)}
              </Text>
            </View>
            <View>
              {pages.map((page) => (
                <Text
                  key={page.subtitle}
                  callout
                  secondary
                  centered
                  position="absolute"
                  left={0}
                  right={0}
                  opacity={0}
                  pointerEvents="none"
                  aria-hidden
                  onLayout={({ nativeEvent }) =>
                    setSubtitles((previous) => ({ ...previous, [page.subtitle]: nativeEvent.layout.height }))
                  }
                >
                  {t(page.subtitle, { max: MAX_INSTALLMENTS })}
                </Text>
              ))}
              <Text callout secondary centered height={Math.max(0, ...Object.values(subtitles))}>
                {t(currentItem.subtitle, { max: MAX_INSTALLMENTS })}
              </Text>
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
                  <UserPlus />
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
                    <LogIn />
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
        onContact={() => {
          setErrorDialogOpen(false);
          loginUnidentified().then(present).catch(reportError);
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
      <TimeToFullDisplay record={stage !== undefined && measured} />
    </SafeView>
  );
}

export type Page = {
  image: number;
  subtitle: string;
  title: string;
};

const pages: [Page, ...Page[]] = [
  {
    image: creditCard,
    title: "Spend your digital assets worldwide",
    subtitle: "Do it with a free Visa Signature card and a US virtual bank account.",
  },
  {
    image: calendar,
    title: "Pay later and hold your digital assets",
    subtitle: "Split any purchase into up to {{max}} fixed-rate installments.",
  },
  {
    image: earnArrow,
    title: "Your assets grow while you spend",
    subtitle: "Earn yield on your digital assets and still spend against them.",
  },
];
