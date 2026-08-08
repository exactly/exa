import { renderToBuffer } from "@react-pdf/renderer";
import { isValidElement } from "react";

import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import AccountStatement from "../../utils/AccountStatement";

describe("account statement rendering", () => {
  it("renders all activity types", async () => {
    const statement = {
      account: "0x92bD...e82AB8",
      period: "December, 2025",
      cards: [{ amount: 1407, cardId: "card-6789", lastFour: "6789" }],
      activities: [
        {
          id: "purchase-1",
          timestamp: "2025-12-19T11:35:11.030Z",
          amount: -50.25,
          title: "grocery store",
          detail: "Debit purchase – Card **** 1234",
        },
        {
          id: "deposit-1",
          timestamp: "2025-12-19T11:35:11.030Z",
          amount: 100,
          title: "Funds added",
          detail: "1.45 ETH",
        },
        {
          id: "repay-1",
          timestamp: "2025-12-19T11:35:11.030Z",
          amount: -30,
          title: "Debt payment",
          detail: "942.63 USDC",
        },
        {
          id: "withdraw-1",
          timestamp: "2025-12-19T11:35:11.030Z",
          amount: -20,
          title: "Sent to 0x92bD...e82AB8",
          detail: "200 USD",
        },
      ],
    };
    const pdf = await renderToBuffer(AccountStatement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    expect(extractPages(pdf)).toHaveLength(1);
    const text = collectText(AccountStatement(statement));
    expect(text).not.toContain("Account balance");
    expect(text).not.toContain("As of 19/12/2025");
    expect(text).toContain("Card **** 6789");
    expect(text).toContain("Debit purchases in the period");
    expect(text).toContain("$1,407.00");
    expect(text).toContain("Account movements");
    expect(text).toContain("Dec 19, 2025");
    expect(text).toContain("grocery store");
    expect(text).toContain("Debit purchase – Card **** 1234");
    expect(text).toContain("-$50.25");
    expect(text).toContain("Funds added");
    expect(text).toContain("1.45 ETH");
    expect(text).toContain("$100.00");
    expect(text).toContain("Debt payment");
    expect(text).toContain("942.63 USDC");
    expect(text).toContain("-$30.00");
    expect(text).toContain("Sent to 0x92bD...e82AB8");
    expect(text).toContain("200 USD");
    expect(text).toContain("-$20.00");
    expect(text).not.toContain("ACCOUNT BALANCE");
    expect(text).not.toContain("TOTAL BALANCE");
    expect(text).not.toContain("—");
    expect(collectText(AccountStatement({ ...statement, period: undefined }))).not.toContain("Debit purchases");
  });

  it.each([
    [14, 1],
    [15, 1],
    [23, 2],
    [37, 2],
  ])("flows rows across the %d-row page boundary", async (count, total) => {
    const statement = {
      account: "0x92bD...e82AB8",
      period: "December, 2025",
      cards: [],
      activities: Array.from({ length: count }, (_, index) => ({
        id: `movement-${index}-row`,
        timestamp: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
        amount: 10,
        title: `movement-${index}-row`,
        detail: "1 USDC",
      })),
    };
    const pdf = await renderToBuffer(AccountStatement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    const pages = extractPages(pdf);
    expect(pages).toHaveLength(total);
    expect(pages.every(({ text }) => ["DATE", "MOVEMENT", "AMOUNT"].every((label) => text.includes(label)))).toBe(true);
    expect(pages.map(({ raw }) => /\d+ • \d+$/.exec(extractText(raw))?.[0]?.replace(/^0+(?=\d)/, ""))).toEqual(
      Array.from({ length: total }, (_, index) => `${index + 1} • ${total}`),
    );
    for (let index = 0; index < count; index++) {
      expect(pages.filter(({ text }) => text.includes(`movement-${index}-row`))).toHaveLength(1);
    }
    expect(pages[0]?.text).toContain("movement-0");
    expect(pages.at(-1)?.text).toContain(`movement-${count - 1}`);
    expect(pages.every(({ text }) => !text.includes("ACCOUNT BALANCE"))).toBe(true);
    expect(pages.every(({ text }) => !text.includes("TOTAL BALANCE"))).toBe(true);
  });

  it("renders cards and movements together", async () => {
    const statement = {
      account: "0x92bD...e82AB8",
      period: "December, 2025",
      cards: Array.from({ length: 6 }, (_, index) => ({
        amount: index + 1,
        cardId: `card-${index}`,
        lastFour: `${index}${index}${index}${index}`,
      })),
      activities: Array.from({ length: 37 }, (_, index) => ({
        id: `movement-${index}-row`,
        timestamp: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
        amount: 10,
        title: `movement-${index}-row`,
        detail: "1 USDC",
      })),
    };
    const pdf = await renderToBuffer(AccountStatement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    const pages = extractPages(pdf);
    expect(pages).toHaveLength(3);
    expect(pages[0]?.text).toContain("Card **** 0000");
    expect(pages[0]?.text).toContain("Card **** 5555");
    expect(pages[0]?.text).toContain("movement-0");
    expect(pages.every(({ text }) => ["DATE", "MOVEMENT", "AMOUNT"].every((label) => text.includes(label)))).toBe(true);
    expect(pages.at(-1)?.text).toContain("movement-36");
    expect(pages.every(({ text }) => !text.includes("ACCOUNT BALANCE"))).toBe(true);
    expect(pages.every(({ text }) => !text.includes("TOTAL BALANCE"))).toBe(true);
  });

  it("keeps the movement heading with the table start after summary cards", async () => {
    const statement = {
      account: "0x92bD...e82AB8",
      period: "December, 2025",
      cards: Array.from({ length: 6 }, (_, index) => ({
        amount: index + 1,
        cardId: `card-${index}`,
        lastFour: `${index}${index}${index}${index}`,
      })),
      activities: Array.from({ length: 14 }, (_, index) => ({
        id: `movement-${index}-row`,
        timestamp: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
        amount: 10,
        title: `movement-${index}-row`,
        detail: "1 USDC",
      })),
    };
    const pdf = await renderToBuffer(AccountStatement(statement));
    const pages = extractPages(pdf);
    const tableStartPage = pages.find(({ text }) => text.includes("Account movements"));
    expect(tableStartPage?.text).toContain("DATE");
    expect(tableStartPage?.text).toContain("movement-0-row");
  });

  it("renders many cards with movements on one page", async () => {
    const statement = {
      account: "0x92bD...e82AB8",
      period: "December, 2025",
      cards: Array.from({ length: 9 }, (_, index) => ({
        amount: index + 1,
        cardId: `card-${index}`,
        lastFour: `${index}${index}${index}${index}`,
      })),
      activities: [
        {
          id: "movement-0-row",
          timestamp: "2025-01-01T00:00:00.000Z",
          amount: 10,
          title: "movement-0-row",
          detail: "1 USDC",
        },
      ],
    };
    const pdf = await renderToBuffer(AccountStatement(statement));
    const pages = extractPages(pdf);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toContain("Card **** 0000");
    expect(pages[0]?.text).toContain("Card **** 8888");
    expect(pages[0]?.text).toContain("movement-0-row");
  });
});

function collectText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((element) => collectText(element)).join("");
  if (isValidElement<{ children?: unknown }>(node)) return collectText(node.props.children);
  return "";
}

function extractPages(pdf: Uint8Array) {
  const source = new TextDecoder("latin1").decode(pdf);
  return [...source.matchAll(/\/Type \/Page\b[\s\S]{0,400}?\/Contents (\d+) 0 R/g)].map(([, reference]) => {
    const object = [...source.matchAll(/(?:^|\n)(\d+) 0 obj[\s\S]*?endobj/g)]
      .map((match) => ({ index: match.index, reference: match[1], value: match[0] })) // cspell:ignore endobj FlateDecode
      .find(({ reference: id, value }) => id === reference && value.includes("/Filter /FlateDecode"));
    if (object === undefined) throw new Error("expected compressed page content");
    const marker = source.indexOf("stream", object.index);
    const stream = source[marker + 6] === "\r" ? marker + 8 : marker + 7;
    const end = source.indexOf("endstream", stream);
    const raw = new TextDecoder("latin1").decode(inflateSync(pdf.slice(stream, end)));
    return { raw, text: extractText(raw) };
  });
}

function extractText(value: string) {
  return [...value.matchAll(/<([0-9a-f]+)>/gi)]
    .map(([, hex]) => hex)
    .filter((hex): hex is string => hex !== undefined)
    .map((hex) =>
      new TextDecoder("latin1").decode(
        Uint8Array.from(hex.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? []),
      ),
    )
    .join("")
    .replaceAll("\u0095", "•");
}
