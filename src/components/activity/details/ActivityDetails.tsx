import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowLeft, Headphones } from "@tamagui/lucide-icons";

import { useQuery } from "@tanstack/react-query";

import CardActivity from "./CardActivity";
import DeclinedActivity from "./DeclinedActivity";
import ReceivedActivity from "./ReceivedActivity";
import RepayActivity from "./RepayActivity";
import SentActivity from "./SentActivity";
import { present } from "../../../utils/intercom";
import reportError from "../../../utils/reportError";
import GradientScrollView from "../../shared/GradientScrollView";
import IconButton from "../../shared/IconButton";
import Button from "../../shared/StyledButton";

import type { ActivityItem } from "../../../utils/queryClient";

export default function ActivityDetails() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: item } = useQuery<ActivityItem>({ queryKey: ["activity", "details"] });
  if (!item) return null;
  return (
    <GradientScrollView variant="neutral" stickyHeader>
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
