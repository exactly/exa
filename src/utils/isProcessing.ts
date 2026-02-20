import { isAfter, subDays } from "date-fns";

import type { ActivityItem } from "./queryClient";

export default function isProcessing(timestamp: number | string) {
  const nextReset = subDays(new Date(), 1);
  nextReset.setUTCHours(13, 0, 0, 0);
  return isAfter(new Date(timestamp), nextReset);
}

export function selectBalance(activity: ActivityItem[]) {
  return activity.reduce(
    (total, item) => (item.type === "panda" && isProcessing(item.timestamp) ? total + item.usdAmount : total),
    0,
  );
}
