import React from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, Headphones } from "@tamagui/lucide-icons";
import { YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import CardActivity from "./CardActivity";
import DeclinedActivity from "./DeclinedActivity";
import ReceivedActivity from "./ReceivedActivity";
import RepayActivity from "./RepayActivity";
import SentActivity from "./SentActivity";
import { present } from "../../../utils/intercom";
import queryClient from "../../../utils/queryClient";
import reportError from "../../../utils/reportError";
import GradientScrollView from "../../shared/GradientScrollView";
import IconButton from "../../shared/IconButton";
import SafeView from "../../shared/SafeView";
import ExaSpinner from "../../shared/Spinner";
import Button from "../../shared/StyledButton";

import type { Activity } from "../../../utils/server";

export default function ActivityDetails() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    data: activity,
    isPending,
    isFetching,
    isPlaceholderData,
  } = useQuery<Activity>({
    queryKey: ["activity"],
    staleTime: 0,
    placeholderData: () => queryClient.getQueryData<Activity>(["activity", "card"]),
  });
  const item = activity?.find((entry) => entry.id === id);
  if (!item && (isPending || isFetching || isPlaceholderData)) {
    return (
      <SafeView fullScreen padded>
        <Back />
        <YStack flex={1} justifyContent="center" alignItems="center">
          <ExaSpinner backgroundColor="transparent" />
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
      {item.type === "panda" &&
        (item.status === "declined" ? <DeclinedActivity item={item} /> : <CardActivity item={item} />)}
      <Button
        outlined
        width="100%"
        alignSelf="flex-end"
        marginTop="$s4"
        marginBottom="$s5"
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
          router.replace("/(main)/(home)");
        }
      }}
    />
  );
}
