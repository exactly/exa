import { renderToBuffer } from "@react-pdf/renderer";
import { isValidElement, type ReactNode } from "react";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { MATURITY_INTERVAL } from "@exactly/lib";

import AccountStatement from "../../utils/AccountStatement";
import Statement, { format } from "../../utils/Statement";

const directory = path.join("node_modules/@exactly/.runtime");

describe("statement rendering", () => {
  beforeAll(async () => {
    await mkdir(directory, { recursive: true });
  });
  it("renders with purchases", async () => {
    const statement = {
      account: "0x92bD...e82BA8",
      cards: [
        {
          id: "card-1",
          lastFour: "1234",
          purchases: [
            {
              id: "purchase-1",
              description: "grocery store",
              installments: [{ amount: 50.25, current: 1, total: 3 }],
              timestamp: "2025-12-19T11:35:11.030Z",
            },
            {
              id: "purchase-2",
              description: "gas station",
              installments: [{ amount: 30.5, current: 2, total: 2 }],
              timestamp: "2025-12-19T11:22:49.412Z",
            },
          ],
        },
      ],
      maturity: 1_768_435_200,
      payments: [],
    };
    const pdf = await renderToBuffer(Statement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    await writeFile(path.join(directory, `statement-purchases-${Date.now()}.pdf`), new Uint8Array(pdf)); // eslint-disable-line security/detect-non-literal-fs-filename -- test artifact

    const text = collectText(Statement(statement));
    expect(text).toContain("Statement");
    expect(text).toContain("Account 0x92bD...e82BA8");
    expect(text).toContain("Card **** 1234");
    expect(text).toContain(format(1_768_435_200 * 1000));
    expect(text).toContain(format((1_768_435_200 - MATURITY_INTERVAL) * 1000));
    expect(text).toContain("grocery store");
    expect(text).toContain("$50.25");
    expect(text).toContain("gas station");
    expect(text).toContain("$30.50");
    expect(text).toContain("Summary");
    expect(text).toContain("Due balance");
  });

  it("renders with payments", async () => {
    const statement = {
      account: "0x92bD...e82BA8",
      cards: [
        {
          id: "card-1",
          lastFour: "1234",
          purchases: [
            {
              id: "purchase-1",
              description: "coffee shop",
              installments: [{ amount: 100, current: 1, total: 1 }],
              timestamp: "2025-12-19T11:35:11.030Z",
            },
          ],
        },
      ],
      maturity: 1_768_435_200,
      payments: [{ id: "repay-1", amount: 100, positionAmount: 100, timestamp: "2025-12-19T11:35:11.030Z" }],
    };
    const pdf = await renderToBuffer(Statement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    await writeFile(path.join(directory, `statement-payments-${Date.now()}.pdf`), new Uint8Array(pdf)); // eslint-disable-line security/detect-non-literal-fs-filename -- test artifact
    const text = collectText(Statement(statement));
    expect(text).toContain("Statement");
    expect(text).toContain("Account 0x92bD...e82BA8");
    expect(text).toContain("Card **** 1234");
    expect(text).toContain(format(1_768_435_200 * 1000));
    expect(text).toContain(format((1_768_435_200 - MATURITY_INTERVAL) * 1000));
    expect(text).toContain("Payments");
    expect(text).toContain("$100.00");
  });

  it("renders with empty data", async () => {
    const statement = {
      account: "0x92bD...e82BA8",
      cards: [],
      maturity: 1_768_435_200,
      payments: [],
    };
    const pdf = await renderToBuffer(Statement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    await writeFile(path.join(directory, `statement-empty-${Date.now()}.pdf`), new Uint8Array(pdf)); // eslint-disable-line security/detect-non-literal-fs-filename -- test artifact
    const text = collectText(Statement(statement));
    expect(text).toContain("Statement");
    expect(text).toContain("Account 0x92bD...e82BA8");
    expect(text).toContain(format(1_768_435_200 * 1000));
    expect(text).toContain(format((1_768_435_200 - MATURITY_INTERVAL) * 1000));
    expect(text).toContain("Summary");
    expect(text).toContain("Due balance");
  });

  it("renders with multiple cards", async () => {
    const statement = {
      account: "0x92bD...e82BA8",
      cards: [
        {
          id: "card-1",
          lastFour: "1234",
          purchases: [
            {
              id: "purchase-1",
              description: "grocery store",
              installments: [{ amount: 50, current: 1, total: 1 }],
              timestamp: "2025-12-19T11:35:11.030Z",
            },
          ],
        },
        {
          id: "card-2",
          lastFour: "5678",
          purchases: [
            {
              id: "purchase-2",
              description: "online purchase",
              installments: [{ amount: 75, current: 1, total: 1 }],
              timestamp: "2025-12-19T11:22:49.412Z",
            },
          ],
        },
      ],
      maturity: 1_768_435_200,
      payments: [{ id: "repay-1", amount: 25, positionAmount: 25, timestamp: "2025-12-20T10:00:00.000Z" }],
    };
    const pdf = await renderToBuffer(Statement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    await writeFile(path.join(directory, `statement-multiple-cards-${Date.now()}.pdf`), new Uint8Array(pdf)); // eslint-disable-line security/detect-non-literal-fs-filename -- test artifact
    const text = collectText(Statement(statement));
    expect(text).toContain("Statement");
    expect(text).toContain("Account 0x92bD...e82BA8");
    expect(text).toContain("Card **** 1234");
    expect(text).toContain("Card **** 5678");
    expect(text).toContain(format(1_768_435_200 * 1000));
    expect(text).toContain(format((1_768_435_200 - MATURITY_INTERVAL) * 1000));
    expect(text).toContain("grocery store");
    expect(text).toContain("$50.00");
    expect(text).toContain("online purchase");
    expect(text).toContain("$75.00");
    expect(text).toContain("Summary");
    expect(text).toContain("Due balance");
    expect(text).toContain("Payments");
    expect(text).toContain("$25.00");
  });

  it("renders discount chip for early payment", async () => {
    const statement = {
      account: "0x92bD...e82BA8",
      cards: [
        {
          id: "card-1",
          lastFour: "1234",
          purchases: [
            {
              id: "purchase-1",
              description: "coffee shop",
              installments: [{ amount: 105.82, current: 1, total: 1 }],
              timestamp: "2025-12-19T11:35:11.030Z",
            },
          ],
        },
      ],
      maturity: 1_768_435_200,
      payments: [{ id: "repay-1", amount: 100, positionAmount: 105.82, timestamp: "2025-12-19T11:35:11.030Z" }],
    };
    const pdf = await renderToBuffer(Statement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    await writeFile(path.join(directory, `statement-discount-${Date.now()}.pdf`), new Uint8Array(pdf)); // eslint-disable-line security/detect-non-literal-fs-filename -- test artifact
    const text = collectText(Statement(statement));
    expect(text).toContain("5.50% discount");
    expect(text).not.toContain("penalty");
    expect(text).toContain("$0.00");
  });

  it("renders penalty chip for late payment", async () => {
    const statement = {
      account: "0x92bD...e82BA8",
      cards: [
        {
          id: "card-1",
          lastFour: "1234",
          purchases: [
            {
              id: "purchase-1",
              description: "coffee shop",
              installments: [{ amount: 100, current: 1, total: 1 }],
              timestamp: "2025-12-19T11:35:11.030Z",
            },
          ],
        },
      ],
      maturity: 1_768_435_200,
      payments: [{ id: "repay-1", amount: 102.31, positionAmount: 100, timestamp: "2025-12-19T11:35:11.030Z" }],
    };
    const pdf = await renderToBuffer(Statement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    await writeFile(path.join(directory, `statement-penalty-${Date.now()}.pdf`), new Uint8Array(pdf)); // eslint-disable-line security/detect-non-literal-fs-filename -- test artifact
    const text = collectText(Statement(statement));
    expect(text).toContain("2.31% penalty");
    expect(text).not.toContain("discount");
    expect(text).toContain("$0.00");
  });

  it("renders no chip when amount equals positionAmount", async () => {
    const statement = {
      account: "0x92bD...e82BA8",
      cards: [
        {
          id: "card-1",
          lastFour: "1234",
          purchases: [
            {
              id: "purchase-1",
              description: "coffee shop",
              installments: [{ amount: 100, current: 1, total: 1 }],
              timestamp: "2025-12-19T11:35:11.030Z",
            },
          ],
        },
      ],
      maturity: 1_768_435_200,
      payments: [{ id: "repay-1", amount: 100, positionAmount: 100, timestamp: "2025-12-19T11:35:11.030Z" }],
    };
    const pdf = await renderToBuffer(Statement(statement));
    await writeFile(path.join(directory, `statement-no-chip-${Date.now()}.pdf`), new Uint8Array(pdf)); // eslint-disable-line security/detect-non-literal-fs-filename -- test artifact
    const text = collectText(Statement(statement));
    expect(text).not.toContain("discount");
    expect(text).not.toContain("penalty");
  });

  it("renders account statement with all activity types", async () => {
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
          detail: "Debit purchase - Card **** 1234",
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
    await writeFile(path.join(directory, `account-statement-${Date.now()}.pdf`), new Uint8Array(pdf)); // eslint-disable-line security/detect-non-literal-fs-filename -- test artifact
    const text = collectText(AccountStatement(statement));
    expect(text).toContain("Account balance");
    expect(text).toContain("Card **** 6789");
    expect(text).toContain("Debit purchases in the period");
    expect(text).toContain("$1,407.00");
    expect(text).toContain("Account movements");
    expect(text).toContain("grocery store");
    expect(text).toContain("Debit purchase - Card **** 1234");
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
    expect(text).toContain("TOTAL BALANCE");
    expect(text).toContain("-$0.25");
  });
});

function collectText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((element) => collectText(element as ReactNode)).join("");
  if (isValidElement<{ children: ReactNode }>(node)) return collectText(node.props.children);
  return "";
}
