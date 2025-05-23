import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import React, { useMemo } from "react";
import { FlatList, RefreshControl } from "react-native";
import { styled, useTheme } from "tamagui";

import ActivityItem from "./ActivityItem";
import Empty from "./Empty";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getActivity } from "../../utils/server";
import useAsset from "../../utils/useAsset";
import ProcessingBalanceBanner from "../shared/ProcessingBalanceBanner";
import ProposalBanner from "../shared/ProposalBanner";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Activity() {
  const theme = useTheme();
  const { data: activity, refetch, isPending } = useQuery({ queryKey: ["activity"], queryFn: () => getActivity() });
  const { queryKey } = useAsset();
  const groupedActivity = useMemo(() => {
    if (!activity) return [];
    const groups: Record<string, typeof activity> = {};
    for (const item of activity) {
      const date = format(item.timestamp, "yyyy-MM-dd");
      groups[date] = groups[date] ?? [];
      groups[date].push(item);
    }
    return Object.entries(groups).map(([date, events]) => ({ date, events }));
  }, [activity]);
  const data = groupedActivity.flatMap(({ date, events }) => [
    { type: "header" as const, date },
    ...events.map((event) => ({ type: "event" as const, event })),
  ]);
  const style = { backgroundColor: theme.backgroundSoft.val, margin: -5 };
  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View gap="$s5" flex={1} backgroundColor="$backgroundMild">
        <StyledFlatList
          ref={activityScrollReference}
          backgroundColor={data.length > 0 ? "$backgroundMild" : "$backgroundSoft"}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              ref={activityRefreshControlReference}
              style={style}
              refreshing={isPending}
              onRefresh={() => {
                refetch().catch(reportError);
                queryClient.refetchQueries({ queryKey }).catch(reportError);
              }}
            />
          }
          ListHeaderComponent={
            <>
              <View padded gap="$s5" backgroundColor="$backgroundSoft">
                <View flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
                  <Text fontSize={20} fontWeight="bold">
                    All Activity
                  </Text>
                </View>
              </View>
              <ProposalBanner />
              <ProcessingBalanceBanner />
            </>
          }
          ListEmptyComponent={<Empty />}
          data={data}
          renderItem={({ item }) => {
            if (item.type === "header") {
              const { date } = item;
              return (
                <View paddingHorizontal="$s4" paddingVertical="$s3" backgroundColor="$backgroundSoft">
                  <Text subHeadline color="$uiNeutralSecondary">
                    {date}
                  </Text>
                </View>
              );
            }
            const { event } = item;
            return (
              <ActivityItem
                key={event.id}
                item={event}
                isLast={
                  data.findIndex(
                    (activityItem) => activityItem.type === "event" && activityItem.event.id === event.id,
                  ) ===
                  data.length - 1
                }
              />
            );
          }}
          keyExtractor={(item, index) => `${item.type}-${index}`}
          stickyHeaderIndices={data.flatMap((item, index) => (item.type === "header" ? [index + 1] : []))}
        />
      </View>
    </SafeView>
  );
}

type ActivityItemType =
  | {
      type: "header";
      date: string;
    }
  | {
      type: "event";
      event: Awaited<ReturnType<typeof getActivity>>[number];
    };
const StyledFlatList = styled(FlatList<ActivityItemType>, { backgroundColor: "$backgroundMild" });
export const activityScrollReference = React.createRef<FlatList>();
export const activityRefreshControlReference = React.createRef<RefreshControl>();
