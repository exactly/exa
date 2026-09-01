import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, PixelRatio, useWindowDimensions } from "react-native";
import type { LayoutChangeEvent } from "react-native";

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
import RefreshControl from "../shared/RefreshControl";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Activity() {
  const { data: activity } = useQuery<ActivityEvent[]>({ queryKey: ["activity"] });
  const { queryKey } = useAsset();
  const { fontScale } = useWindowDimensions();
  const theme = useTheme();
  const [headerHeight, setHeaderHeight] = useState<number>();
  const [limit, setLimit] = useState(page);

  const layout = useMemo(() => {
    const events = activity?.slice(0, limit) ?? [];
    const items: ActivityItemType[] = [];
    const offsets: number[] = [];
    const stickies: number[] = [];
    const dateHeight = PixelRatio.roundToNearestPixel(21 * fontScale) + 16;
    let currentDate: string | undefined;
    let offset = 0;

    for (const [index, event] of events.entries()) {
      const date = format(event.timestamp, "yyyy-MM-dd");
      if (date !== currentDate) {
        stickies.push(items.length + 1);
        offsets.push(offset);
        offset += dateHeight;
        items.push({ type: "header", date, height: dateHeight });
        currentDate = date;
      }
      const isLast = index === events.length - 1;
      const rowHeight = PixelRatio.roundToNearestPixel(Math.max(40, 38 * fontScale + 4)) + (isLast ? 24 : 16);
      offsets.push(offset);
      offset += rowHeight;
      items.push({ type: "event", event, height: rowHeight, isLast });
    }
    offsets.push(offset);

    return { items, offsets, stickies };
  }, [activity, fontScale, limit]);

  const onHeaderLayout = useCallback(
    (event: LayoutChangeEvent) => setHeaderHeight(event.nativeEvent.layout.height),
    [],
  );

  const listRef = useRef<FlatList<ActivityItemType>>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["activity"], exact: true }),
      queryClient.refetchQueries({ queryKey }),
    ]);
  useTabPress("activity", () => {
    if (layout.items.length > 0) listRef.current?.scrollToIndex({ index: 0, animated: true });
    refresh()
      .then(() => setLimit(page))
      .catch(reportError);
  });

  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View
        fullScreen
        gap="$s5"
        flex={1}
        backgroundColor={layout.items.length > 0 ? "$backgroundMild" : "$backgroundSoft"}
      >
        <View position="absolute" top={0} left={0} right={0} height="50%" backgroundColor="$backgroundSoft" />
        <FlatList<ActivityItemType>
          ref={listRef}
          style={{ flex: 1 }}
          onScrollToIndexFailed={() => undefined}
          contentContainerStyle={{
            flexGrow: 1,
            backgroundColor: layout.items.length > 0 ? theme.backgroundMild.val : theme.backgroundSoft.val,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl onRefresh={refresh} />}
          ListHeaderComponent={<ListHeader onLayout={onHeaderLayout} />}
          ListEmptyComponent={<Empty />}
          data={layout.items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={
            headerHeight === undefined
              ? undefined
              : (_, index) => ({
                  length: (layout.offsets[index + 1] ?? 0) - (layout.offsets[index] ?? 0),
                  offset: headerHeight + (layout.offsets[index] ?? 0),
                  index,
                })
          }
          initialNumToRender={14}
          maxToRenderPerBatch={8}
          windowSize={5}
          onEndReachedThreshold={1}
          onEndReached={() => setLimit((current) => (activity && current < activity.length ? current + page : current))}
          stickyHeaderIndices={layout.stickies}
        />
      </View>
    </SafeView>
  );
}

const page = 40;

type ActivityItemType =
  | { date: string; height: number; type: "header" }
  | { event: ActivityEvent; height: number; isLast: boolean; type: "event" };

const ListHeader = memo(function ListHeader({ onLayout }: { onLayout: (event: LayoutChangeEvent) => void }) {
  const { t } = useTranslation();
  return (
    <View onLayout={onLayout}>
      <View padded backgroundColor="$backgroundSoft">
        <Text fontSize={20} fontWeight="bold">
          {t("All Activity")}
        </Text>
      </View>
      <ProposalBanner />
      <ProcessingBalanceBanner />
    </View>
  );
});
ListHeader.displayName = "ListHeader";

const HeaderRow = memo(function HeaderRow({ date, height }: { date: string; height: number }) {
  return (
    <View height={height} paddingHorizontal="$s4" paddingVertical="$s3" backgroundColor="$backgroundSoft">
      <Text subHeadline color="$uiNeutralSecondary">
        {date}
      </Text>
    </View>
  );
});
HeaderRow.displayName = "HeaderRow";

function renderItem({ item }: { item: ActivityItemType }) {
  if (item.type === "header") return <HeaderRow date={item.date} height={item.height} />;
  return <MemoizedActivityItem item={item.event} height={item.height} isLast={item.isLast} />;
}

function keyExtractor(item: ActivityItemType) {
  return item.type === "header" ? `header-${item.date}` : `event-${item.event.id}`;
}

const MemoizedActivityItem = memo(ActivityItem);
MemoizedActivityItem.displayName = "MemoizedActivityItem";
