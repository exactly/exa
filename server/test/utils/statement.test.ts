import { renderToBuffer } from "@react-pdf/renderer";

import { describe, expect, it } from "vitest";

import Statement from "../../utils/Statement";

describe("statement rendering", () => {
  it("renders with purchases", async () => {
    const pdf = await renderToBuffer(
      Statement({
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
      }),
    );
    expect(pdf.byteLength).toBeGreaterThan(0);
  });

  it("renders with repayments", async () => {
    const pdf = await renderToBuffer(
      Statement({
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
      }),
    );
    expect(pdf.byteLength).toBeGreaterThan(0);
  });

  it("renders with empty data", async () => {
    const pdf = await renderToBuffer(Statement({ data: [], lastFour: "", maturity: 1_768_435_200 }));
    expect(pdf.byteLength).toBeGreaterThan(0);
  });

  it("renders with both purchases and repayments", async () => {
    const pdf = await renderToBuffer(
      Statement({
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
      }),
    );
    expect(pdf.byteLength).toBeGreaterThan(0);
  });
});
