import { Platform } from "react-native";

import { File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";

import { getStatement } from "./server";

import type { getStatementActivity } from "./server";

export function group(items: Awaited<ReturnType<typeof getStatementActivity>>) {
  const cards = new Map<string, { dates: Map<string, { label: string; rows: Row[] }>; id: string; lastFour: string }>();
  const payments: Payment[] = [];
  for (const item of items) {
    if (item.type === "repay") {
      payments.push({
        id: item.id,
        amount: item.amount,
        positionAmount: item.positionAmount,
        timestamp: item.timestamp,
      });
      continue;
    }
    if (item.type !== "panda" && item.type !== "card") continue;
    const lines = (item.type === "panda" ? item.operations : [item]).flatMap((operation) =>
      "borrow" in operation
        ? "installments" in operation.borrow
          ? operation.borrow.installments.map((installment) => ({
              id: `${operation.transactionHash}:${installment.current}`,
              current: installment.current,
              total: operation.mode,
              amount: installment.amount,
            }))
          : [{ id: `${operation.transactionHash}:1`, current: 1, total: 1, amount: operation.borrow.amount }]
        : [],
    );
    if (lines.length === 0) continue;
    const card = cards.get(item.cardId) ?? {
      id: item.cardId,
      lastFour: item.lastFour,
      dates: new Map<string, { label: string; rows: Row[] }>(),
    };
    const key = item.timestamp.slice(0, 10);
    const dates = card.dates.get(key) ?? { label: item.timestamp, rows: [] };
    dates.rows.push(...lines.map((line) => ({ merchant: item.merchant.name, ...line })));
    card.dates.set(key, dates);
    cards.set(item.cardId, card);
  }
  const grouped = [...cards.values()]
    .map(({ id, lastFour, dates }) => {
      const days = [...dates.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => ({ key, ...value }));
      const total = days.reduce((sum, { rows }) => sum + rows.reduce((amount, row) => amount + row.amount, 0), 0);
      return { id, lastFour, dates: days, total };
    })
    .sort((a, b) => a.lastFour.localeCompare(b.lastFour));
  const purchases = grouped.reduce((sum, { total }) => sum + total, 0);
  const paid = payments.reduce((sum, { amount }) => sum + amount, 0);
  const settled = payments.reduce((sum, { positionAmount }) => sum + positionAmount, 0);
  return {
    cards: grouped,
    payments: payments.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    paid,
    discount: settled - paid,
    due: purchases - settled,
  };
}

export async function downloadStatement(maturity: number, filename: string) {
  const bytes = await getStatement(maturity);
  if (Platform.OS !== "web") {
    if (!(await isAvailableAsync())) throw new Error("sharing unavailable");
    const file = new File(Paths.cache, filename);
    if (file.exists) file.delete();
    await file.write(bytes);
    await shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: filename });
    return;
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

type Row = { amount: number; current: number; id: string; merchant: string; total: number };
type Payment = { amount: number; id: string; positionAmount: number; timestamp: string };
