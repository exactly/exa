import { renderToBuffer } from "@react-pdf/renderer";
import { isValidElement, type ReactNode } from "react";

import { describe, expect, it } from "vitest";

import { MATURITY_INTERVAL } from "@exactly/lib";

import Statement, { format } from "../../utils/Statement";

describe("statement rendering", () => {
  it("renders with purchases", async () => {
    const statement = {
      data: [
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
      lastFour: "1234",
      maturity: 1_768_435_200,
    };
    const pdf = await renderToBuffer(Statement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);

    const text = collectText(Statement(statement));
    expect(text).toContain("Exa App");
    expect(text).toContain("Card Statement");
    expect(text).toContain("1768435200");
    expect(text).toContain("**** **** **** 1234");
    expect(text).toContain(format(1_768_435_200));
    expect(text).toContain(format(1_768_435_200 - MATURITY_INTERVAL));
    expect(text).toContain("Purchases");
    expect(text).toContain("grocery store");
    expect(text).toContain("Installment 1 of 3");
    expect(text).toContain("USDC 50.25");
    expect(text).toContain("gas station");
    expect(text).toContain("Installment 2 of 2");
    expect(text).toContain("USDC 30.50");
  });

  it("renders with repayments", async () => {
    const statement = {
      data: [
        {
          id: "repay-1",
          amount: 100,
          currency: "USDC",
          positionAmount: 105.82,
          timestamp: "2025-12-19T11:35:11.030Z",
        },
      ],
      lastFour: "1234",
      maturity: 1_768_435_200,
    };
    const pdf = await renderToBuffer(Statement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    const text = collectText(Statement(statement));
    expect(text).toContain("Exa App");
    expect(text).toContain("Card Statement");
    expect(text).toContain("1768435200");
    expect(text).toContain("**** **** **** 1234");
    expect(text).toContain(format(1_768_435_200));
    expect(text).toContain(format(1_768_435_200 - MATURITY_INTERVAL));
    expect(text).toContain("Payments");
    expect(text).toContain("5.50% discount applied");
    expect(text).toContain("USDC 100.00");
  });

  it("renders with empty data", async () => {
    const statement = {
      data: [],
      lastFour: "",
      maturity: 1_768_435_200,
    };
    const pdf = await renderToBuffer(Statement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    const text = collectText(Statement(statement));
    expect(text).toContain("Exa App");
    expect(text).toContain("Card Statement");
    expect(text).toContain("1768435200");
    expect(text).toContain(format(1_768_435_200));
    expect(text).toContain(format(1_768_435_200 - MATURITY_INTERVAL));
  });

  it("renders with both purchases and repayments", async () => {
    const statement = {
      data: [
        {
          id: "purchase-3",
          description: "online purchase",
          installments: [{ amount: 75, current: 1, total: 1 }],
          timestamp: "2025-12-19T11:35:11.030Z",
        },
        {
          id: "repay-2",
          amount: 200,
          currency: "USDC",
          positionAmount: 206.6,
          timestamp: "2025-12-20T10:00:00.000Z",
        },
      ],
      lastFour: "5678",
      maturity: 1_768_435_200,
    };
    const pdf = await renderToBuffer(Statement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    const text = collectText(Statement(statement));
    expect(pdf.byteLength).toBeGreaterThan(0);
    expect(text).toContain("Exa App");
    expect(text).toContain("Card Statement");
    expect(text).toContain("1768435200");
    expect(text).toContain("**** **** **** 5678");
    expect(text).toContain(format(1_768_435_200));
    expect(text).toContain(format(1_768_435_200 - MATURITY_INTERVAL));
    expect(text).toContain("Purchases");
    expect(text).toContain("online purchase");
    expect(text).toContain("Installment 1 of 1");
    expect(text).toContain("USDC 75.00");
    expect(text).toContain("Payments");
    expect(text).toContain("% discount applied");
    expect(text).toContain("USDC 200.00");
  });
});

function collectText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((element) => collectText(element as ReactNode)).join("");
  if (isValidElement<{ children: ReactNode }>(node)) return collectText(node.props.children);
  return "";
}
