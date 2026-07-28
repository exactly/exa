import { Platform } from "react-native";

import { File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";

import { getStatement } from "./server";

import type { getStatementActivity } from "./server";

export function group(items: Awaited<ReturnType<typeof getStatementActivity>>) {
  const cards = new Map<string, { dates: Map<string, { label: string; rows: Row[] }>; lastFour: string }>();
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
    const lines = installments(item);
    if (lines.length === 0) continue;
    const card = cards.get(item.cardId) ?? {
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
    .map(({ lastFour, dates }) => {
      const days = [...dates.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => ({ key, ...value }));
      const total = days.reduce((sum, { rows }) => sum + rows.reduce((amount, row) => amount + row.amount, 0), 0);
      return { lastFour, dates: days, total };
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
  if (Platform.OS !== "web") return share(bytes, filename);
  const url = pdf(bytes);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function share(bytes: Uint8Array, filename: string) {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.write(bytes);
  if (!(await isAvailableAsync())) throw new Error("sharing unavailable");
  await shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: filename });
}

function pdf(bytes: Uint8Array) {
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
}

function installments(item: Purchase) {
  if (item.type === "panda") {
    return item.operations.flatMap((operation) =>
      "borrow" in operation
        ? "installments" in operation.borrow
          ? operation.borrow.installments.map((installment) => ({
              current: installment.current,
              total: operation.mode,
              amount: installment.amount,
            }))
          : [{ current: 1, total: 1, amount: operation.borrow.amount }]
        : [],
    );
  }
  if (!("borrow" in item)) return [];
  return "installments" in item.borrow
    ? item.borrow.installments.map((installment) => ({
        current: installment.current,
        total: item.mode,
        amount: installment.amount,
      }))
    : [{ current: 1, total: 1, amount: item.borrow.amount }];
}

type Purchase = Extract<Awaited<ReturnType<typeof getStatementActivity>>[number], { type: "card" | "panda" }>;
type Row = { amount: number; current: number; merchant: string; total: number };
type Payment = { amount: number; id: string; positionAmount: number; timestamp: string };
