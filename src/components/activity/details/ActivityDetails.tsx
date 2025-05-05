import { ArrowLeft, Headphones } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { ScrollView, styled, useTheme } from "tamagui";

import CardActivity from "./CardActivity";
import ReceivedActivity from "./ReceivedActivity";
import RepayActivity from "./RepayActivity";
import SentActivity from "./SentActivity";
import type { ActivityItem } from "../../../utils/queryClient";
import reportError from "../../../utils/reportError";
import useIntercom from "../../../utils/useIntercom";
import ActionButton from "../../shared/ActionButton";
import SafeView from "../../shared/SafeView";
import View from "../../shared/View";

export default function ActivityDetails() {
  const { data: item } = useQuery<ActivityItem>({ queryKey: ["activity", "details"] });
  const { present } = useIntercom();
  const { canGoBack } = router;
  const theme = useTheme();
  if (!item) return null;
  return (
    <View fullScreen backgroundColor="$backgroundSoft">
      <StyledGradient
        locations={[0.5, 1]}
        position="absolute"
        top={0}
        left={0}
        right={0}
        height={220}
        opacity={0.8}
        colors={[theme.backgroundStrong.val, theme.backgroundSoft.val]}
      />
      <SafeView backgroundColor="transparent" $platform-web={{ height: "-webkit-fill-available" }}>
        <View fullScreen padded>
          <View fullScreen>
            <ScrollView
              fullscreen
              showsVerticalScrollIndicator={false}
              stickyHeaderIndices={[0]}
              // eslint-disable-next-line react-native/no-inline-styles
              contentContainerStyle={{
                flexGrow: 1,
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "$s4_5",
              }}
              stickyHeaderHiddenOnScroll
            >
              <View flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
                {canGoBack() && (
                  <Pressable
                    onPress={() => {
                      router.back();
                    }}
                  >
                    <ArrowLeft size={24} color="$uiNeutralPrimary" />
                  </Pressable>
                )}
              </View>

              {item.type === "card" && <CardActivity item={item} />}
              {item.type === "received" && <ReceivedActivity item={item} />}
              {item.type === "repay" && <RepayActivity item={item} />}
              {item.type === "sent" && <SentActivity item={item} />}
              {item.type === "panda" && <CardActivity item={item} />}

              <ActionButton
                width="100%"
                maxHeight={60}
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
            </ScrollView>
          </View>
        </View>
      </SafeView>
    </View>
  );
}

const StyledGradient = styled(LinearGradient, {});
