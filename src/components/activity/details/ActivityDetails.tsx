import { ArrowLeft, Headphones } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { XStack } from "tamagui";

import { present } from "../../../utils/intercom";
import type { ActivityItem } from "../../../utils/queryClient";
import reportError from "../../../utils/reportError";
import ActionButton from "../../shared/ActionButton";
import GradientScrollView from "../../shared/GradientScrollView";
import CardActivity from "./CardActivity";
import ReceivedActivity from "./ReceivedActivity";
import RepayActivity from "./RepayActivity";
import SentActivity from "./SentActivity";

export default function ActivityDetails() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: item } = useQuery<ActivityItem>({ queryKey: ["activity", "details"] });
  if (!item) return null;
  return (
    <GradientScrollView variant="neutral" stickyHeader>
      <XStack gap={10} justifyContent="space-between" alignItems="center">
        <Pressable
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/(main)/(home)");
            }
          }}
        >
          <ArrowLeft size={24} color="$uiNeutralPrimary" />
        </Pressable>
      </XStack>
      {item.type === "card" && <CardActivity item={item} />}
      {item.type === "received" && <ReceivedActivity item={item} />}
      {item.type === "repay" && <RepayActivity item={item} />}
      {item.type === "sent" && <SentActivity item={item} />}
      {item.type === "panda" && <CardActivity item={item} />}
      <ActionButton
        width="100%"
        alignSelf="flex-end"
        marginTop="$s4"
        marginBottom="$s5"
        onPress={() => {
          present().catch(reportError);
        }}
        backgroundColor="transparent"
        borderWidth={1}
        borderColor="$interactiveBaseBrandDefault"
        color="$interactiveBaseBrandDefault"
        iconAfter={<Headphones color="$interactiveBaseBrandDefault" />}
      >
        {t("Contact support")}
      </ActionButton>
    </GradientScrollView>
  );
}
