import type { CardActivity } from "./server";

export default function weeklySpend(activity: readonly CardActivity[] | undefined) {
  if (!activity) return 0;
  return activity.reduce((total, item) => {
    if (item.type !== "panda" || item.status === "declined") return total;
    const elapsed = Date.now() - new Date(item.timestamp).getTime();
    return elapsed <= 7 * 24 * 60 * 60 * 1000 ? total + item.usdAmount : total;
  }, 0);
}
