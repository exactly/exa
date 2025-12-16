import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, Headphones } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Pressable } from "react-native";
import { XStack } from "tamagui";

import CardActivity from "./CardActivity";
import ReceivedActivity from "./ReceivedActivity";
import RepayActivity from "./RepayActivity";
import SentActivity from "./SentActivity";
import type { AppNavigationProperties } from "../../../app/(main)/_layout";
import { present } from "../../../utils/intercom";
import type { ActivityItem } from "../../../utils/queryClient";
import reportError from "../../../utils/reportError";
import ActionButton from "../../shared/ActionButton";
import GradientScrollView from "../../shared/GradientScrollView";

export default function ActivityDetails() {
  const navigation = useNavigation<AppNavigationProperties>();
  const { data: item } = useQuery<ActivityItem>({ queryKey: ["activity", "details"] });
  if (!item) return null;
  return (
    <GradientScrollView variant="neutral" stickyHeader>
      <XStack gap={10} justifyContent="space-between" alignItems="center">
        <Pressable
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.replace("(home)", { screen: "activity" });
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
        Contact support
      </ActionButton>
    </GradientScrollView>
  );
}
