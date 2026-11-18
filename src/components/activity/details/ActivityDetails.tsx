import React from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { YStack } from "tamagui";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import CardActivity from "./CardActivity";
import DeclinedActivity from "./DeclinedActivity";
import OnchainActivity from "./OnchainActivity";
import ReceivedActivity from "./ReceivedActivity";
import RepayActivity from "./RepayActivity";
import SentActivity from "./SentActivity";
import { ArrowLeft } from "../../../generated/icons/ArrowLeft";
import { Headphones } from "../../../generated/icons/Headphones";
import { present } from "../../../utils/intercom";
import reportError from "../../../utils/reportError";
import { activityOptions, findActivity, type Activity } from "../../../utils/server";
import GradientScrollView from "../../shared/GradientScrollView";
import IconButton from "../../shared/IconButton";
import SafeView from "../../shared/SafeView";
import ExaSpinner from "../../shared/Spinner";
import Button from "../../shared/StyledButton";
import Text from "../../shared/Text";

export default function ActivityDetails() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    data: activity,
    isPending,
    isFetching,
    isError,
    refetch,
  } = useInfiniteQuery({ ...activityOptions, select: ({ pages }) => pages.flat() });
  const listed = activity?.find((entry) => entry.id === id);
  const { data: card, isFetching: carding } = useQuery<Activity>({
    queryKey: ["activity", "card"],
    enabled: !listed && !isPending,
  });
  const cached = listed ?? card?.find((entry) => entry.id === id);
  const {
    data: found,
    isFetching: finding,
    isError: lost,
    refetch: retry,
  } = useQuery({
    queryKey: ["activity", "item", id],
    queryFn: () => findActivity(id),
    enabled: !cached && !isPending && !isFetching && !isError && !carding,
  });
  const item = cached ?? found ?? undefined;
  if (!item && (isPending || isFetching || carding || finding)) {
    return (
      <SafeView fullScreen padded>
        <Back />
        <YStack flex={1} justifyContent="center" alignItems="center">
          <ExaSpinner backgroundColor="transparent" />
        </YStack>
      </SafeView>
    );
  }
  if (!item && (isError || lost)) {
    return (
      <SafeView fullScreen padded>
        <Back />
        <YStack flex={1} justifyContent="center" alignItems="center" gap="s4">
          <Text textAlign="center" subHeadline color="uiNeutralSecondary">
            {t("Couldn't load this activity. Please try again.")}
          </Text>
          <Button
            outlined
            onPress={() => {
              (isError ? refetch() : retry()).catch(reportError);
            }}
          >
            <Button.Text>{t("Retry")}</Button.Text>
          </Button>
        </YStack>
      </SafeView>
    );
  }
  if (!item) return <Redirect href="/(main)/(home)" />;
  return (
    <GradientScrollView variant="neutral" stickyHeader>
      <Back />
      {item.type === "card" && <CardActivity item={item} />}
      {item.type === "received" && <ReceivedActivity item={item} />}
      {item.type === "repay" && <RepayActivity item={item} />}
      {item.type === "sent" && <SentActivity item={item} />}
      {(item.type === "loan" ||
        item.type === "rollover" ||
        item.type === "swap" ||
        item.type === "liquidation" ||
        item.type === "bridge") && <OnchainActivity item={item} />}
      {item.type === "panda" &&
        (item.status === "declined" ? <DeclinedActivity item={item} /> : <CardActivity item={item} />)}
      <Button
        outlined
        width="100%"
        alignSelf="flex-end"
        marginTop="s4"
        marginBottom="s5"
        onPress={() => {
          present().catch(reportError);
        }}
      >
        <Button.Text>{t("Contact support")}</Button.Text>
        <Button.Icon>
          <Headphones />
        </Button.Icon>
      </Button>
    </GradientScrollView>
  );
}

function Back() {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <IconButton
      alignSelf="flex-start"
      icon={ArrowLeft}
      aria-label={t("Back")}
      onPress={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.dismissTo("/(main)/(home)");
        }
      }}
    />
  );
}
