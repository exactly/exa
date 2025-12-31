import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import React, { memo, useMemo, type RefObject } from "react";
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

type ActivityEvent = Awaited<ReturnType<typeof getActivity>>[number];

export default function Activity() {
  const theme = useTheme();
  const { data: activity, refetch, isPending } = useQuery({ queryKey: ["activity"], queryFn: () => getActivity() });
  const { queryKey } = useAsset();

  const { data, stickyHeaderIndices } = useMemo(() => {
    if (!activity?.length) return { data: [] as ActivityItemType[], stickyHeaderIndices: [] as number[] };

    const items: ActivityItemType[] = [];
    const stickyIndices: number[] = [];
    const totalEvents = activity.length;
    let currentDate: string | undefined;
    let eventPosition = 0;

    for (const event of activity) {
      const date = format(event.timestamp, "yyyy-MM-dd");
      if (date !== currentDate) {
        items.push({ type: "header", date });
        stickyIndices.push(items.length);
        currentDate = date;
      }

      const isLast = eventPosition === totalEvents - 1;
      items.push({ type: "event", event, isLast });
      eventPosition += 1;
    }

    return { data: items, stickyHeaderIndices: stickyIndices };
  }, [activity]);
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
              style={{ backgroundColor: theme.backgroundSoft.val, margin: -5 }}
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
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          stickyHeaderIndices={stickyHeaderIndices}
        />
      </View>
    </SafeView>
  );
}

type ActivityItemType = { type: "header"; date: string } | { type: "event"; event: ActivityEvent; isLast: boolean };

type ActivityItemProperties = React.ComponentProps<typeof ActivityItem>;

const StyledFlatList = styled(FlatList<ActivityItemType>, { backgroundColor: "$backgroundMild" });

export const activityScrollReference: RefObject<FlatList | null> = { current: null };
export const activityRefreshControlReference: RefObject<RefreshControl | null> = { current: null };

const HeaderRow = memo(function HeaderRow({ date }: { date: string }) {
  return (
    <View paddingHorizontal="$s4" paddingVertical="$s3" backgroundColor="$backgroundSoft">
      <Text subHeadline color="$uiNeutralSecondary">
        {date}
      </Text>
    </View>
  );
});
HeaderRow.displayName = "HeaderRow";

function renderItem({ item }: { item: ActivityItemType }) {
  if (item.type === "header") return <HeaderRow date={item.date} />;
  return <MemoizedActivityItem item={item.event} isLast={item.isLast} />;
}

function areActivityItemsEqual(previous: ActivityItemProperties, next: ActivityItemProperties) {
  return previous.item === next.item && previous.isLast === next.isLast;
}

function keyExtractor(item: ActivityItemType) {
  return item.type === "header" ? `header-${item.date}` : `event-${item.event.id}`;
}

const MemoizedActivityItem = memo(ActivityItem, areActivityItemsEqual);
MemoizedActivityItem.displayName = "MemoizedActivityItem";
