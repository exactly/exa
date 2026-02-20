import React, { memo, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, RefreshControl } from "react-native";

import { useTheme } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import ActivityItem from "./ActivityItem";
import Empty from "./Empty";
import queryClient, { type ActivityItem as ActivityEvent } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useTabPress from "../../utils/useTabPress";
import ProcessingBalanceBanner from "../shared/ProcessingBalanceBanner";
import ProposalBanner from "../shared/ProposalBanner";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Activity() {
  const { data: activity, isFetching } = useQuery<ActivityEvent[]>({ queryKey: ["activity"] });
  const { queryKey } = useAsset();
  const { t } = useTranslation();
  const theme = useTheme();

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
        stickyIndices.push(items.length);
        items.push({ type: "header", date });
        currentDate = date;
      }

      const isLast = eventPosition === totalEvents - 1;
      items.push({ type: "event", event, isLast });
      eventPosition += 1;
    }

    return { data: items, stickyHeaderIndices: stickyIndices };
  }, [activity]);

  const listRef = useRef<FlatList<ActivityItemType>>(null);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["activity"], exact: true }).catch(reportError);
    queryClient.refetchQueries({ queryKey }).catch(reportError);
  };
  useTabPress("activity", () => {
    if (data.length > 0) listRef.current?.scrollToIndex({ index: 0, animated: true });
    refresh();
  });

  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen gap="$s5" flex={1} backgroundColor={data.length > 0 ? "$backgroundMild" : "$backgroundSoft"}>
        <View position="absolute" top={0} left={0} right={0} height="50%" backgroundColor="$backgroundSoft" />
        <FlatList<ActivityItemType>
          ref={listRef}
          style={{ flex: 1 }}
          onScrollToIndexFailed={() => undefined}
          contentContainerStyle={{
            flexGrow: 1,
            backgroundColor: data.length > 0 ? theme.backgroundMild.val : theme.backgroundSoft.val,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refresh} />}
          ListHeaderComponent={
            <>
              <View padded gap="$s5" backgroundColor="$backgroundSoft">
                <View flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
                  <Text fontSize={20} fontWeight="bold">
                    {t("All Activity")}
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
          stickyHeaderIndices={stickyHeaderIndices.map((index) => index + 1)}
        />
      </View>
    </SafeView>
  );
}

type ActivityItemType = { date: string; type: "header" } | { event: ActivityEvent; isLast: boolean; type: "event" };
type ActivityItemProperties = React.ComponentProps<typeof ActivityItem>;

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
