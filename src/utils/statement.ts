import { Platform } from "react-native";

import { format } from "date-fns";

import { getStatement, type getStatementActivity } from "./server";

export default function statement(items: Awaited<ReturnType<typeof getStatementActivity>>) {
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
    const lines = new Map<string, Omit<Row, "merchant">>();
    for (const operation of item.type === "panda" ? item.operations : [item]) {
      if (!("borrow" in operation)) continue;
      const { borrow } = operation;
      for (const { current, total, amount } of "installments" in borrow
        ? borrow.installments.map((installment) => ({ ...installment, total: operation.mode }))
        : [{ current: 1, total: 1, amount: borrow.amount }]) {
        const key = `${current}/${total}`;
        const line = lines.get(key) ?? { id: `${item.id}:${key}`, current, total, amount: 0 };
        line.amount += amount;
        lines.set(key, line);
      }
    }
    if (lines.size === 0) continue;
    const card = cards.get(item.cardId) ?? {
      id: item.cardId,
      lastFour: item.lastFour,
      dates: new Map<string, { label: string; rows: Row[] }>(),
    };
    const key = format(item.timestamp, "yyyy-MM-dd");
    const dates = card.dates.get(key) ?? { label: item.timestamp, rows: [] };
    dates.rows.push(...[...lines.values()].map((line) => ({ merchant: item.merchant.name, ...line })));
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
  const paid = payments.reduce((sum, { positionAmount }) => sum + positionAmount, 0);
  return {
    cards: grouped,
    payments: payments.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    paid,
    discount: paid - payments.reduce((sum, { amount }) => sum + amount, 0),
    due: purchases - paid,
  };
}

export async function downloadStatement(maturity: number) {
  if (Platform.OS !== "web") throw new Error("pdf download is web only");
  const bytes = await getStatement(maturity);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `account-statement-${maturity}.pdf`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

type Row = { amount: number; current: number; id: string; merchant: string; total: number };
type Payment = { amount: number; id: string; positionAmount: number; timestamp: string };
