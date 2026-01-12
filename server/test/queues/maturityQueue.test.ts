import "../mocks/onesignal";
import "../mocks/sentry";

import { previewerAbi, previewerAddress } from "@exactly/common/generated/chain";
import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notificationHistory } from "../../database";
import { processor, scheduleMaturityChecks, type CheckDebtsData } from "../../queues/maturityQueue";
import * as onesignal from "../../utils/onesignal";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  readContract: vi.fn(),
}));

vi.mock("bullmq", () => {
  return {
    Queue: vi.fn().mockImplementation(() => ({
      add: mocks.add,
    })),
    Worker: vi.fn().mockImplementation(() => ({
      on: vi.fn().mockReturnThis(),
    })),
  };
});

vi.mock("ioredis", () => ({
  Redis: vi.fn(),
}));

vi.mock("../../database", () => ({
  default: {
    select: mocks.select,
    insert: mocks.insert,
  },
  credentials: { account: "account" },
  notificationHistory: {},
}));

vi.mock("../../utils/publicClient", () => ({
  default: {
    readContract: mocks.readContract,
  },
}));

describe("worker", () => {
  const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("schedules maturity checks", async () => {
    await scheduleMaturityChecks();
    expect(mocks.add).toHaveBeenCalledTimes(2);
    expect(mocks.add).toHaveBeenCalledWith(
      "check-debts",
      expect.objectContaining({ window: "24h" }),
      expect.objectContaining({ jobId: expect.any(String) }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    );
    expect(mocks.add).toHaveBeenCalledWith(
      "check-debts",
      expect.objectContaining({ window: "1h" }),
      expect.objectContaining({ jobId: expect.any(String) }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    );
  });

  it("processes check-debts job", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = 1_234_567_890;
    const window = "24h";

    expect(processor).toBeDefined();

    // Mock DB select
    const fromMock = vi.fn().mockResolvedValue([{ account }]);
    mocks.select.mockReturnValue({ from: fromMock } as never);

    // Mock publicClient
    mocks.readContract.mockResolvedValue([
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n } }] },
    ] as never);

    // Mock DB insert
    const returningMock = vi.fn().mockResolvedValue([{ id: 1 }]);
    const onConflictMock = vi.fn().mockReturnValue({ returning: returningMock });
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictMock });
    mocks.insert.mockReturnValue({ values: valuesMock } as never);

    await processor({
      name: "check-debts",
      data: { maturity, window },
    } as unknown as Job<CheckDebtsData, unknown>);

    expect(mocks.readContract).toHaveBeenCalledWith({
      address: previewerAddress,
      abi: previewerAbi,
      functionName: "exactly",
      args: [account],
    });

    expect(mocks.insert).toHaveBeenCalledWith(notificationHistory);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: { en: "Debt Maturity Alert" },
      contents: { en: "Your debt is due in 24 hours. Repay now to avoid liquidation." },
    });
  });

  it("handles empty debt", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = 1_234_567_890;

    const fromMock = vi.fn().mockResolvedValue([{ account }]);
    mocks.select.mockReturnValue({ from: fromMock } as never);

    mocks.readContract.mockResolvedValue([{ fixedBorrowPositions: [] }] as never);

    await processor({
      name: "check-debts",
      data: { maturity, window: "24h" },
    } as unknown as Job<CheckDebtsData, unknown>);

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("handles duplicate notification", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = 1_234_567_890;

    const fromMock = vi.fn().mockResolvedValue([{ account }]);
    mocks.select.mockReturnValue({ from: fromMock } as never);

    mocks.readContract.mockResolvedValue([
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n } }] },
    ] as never);

    // Mock Conflict (returns empty array)
    const returningMock = vi.fn().mockResolvedValue([]);
    const onConflictMock = vi.fn().mockReturnValue({ returning: returningMock });
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictMock });
    mocks.insert.mockReturnValue({ values: valuesMock } as never);

    await processor({
      name: "check-debts",
      data: { maturity, window: "24h" },
    } as unknown as Job<CheckDebtsData, unknown>);

    expect(mocks.insert).toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("reschedules on 1h window", async () => {
    const fromMock = vi.fn().mockResolvedValue([]);
    mocks.select.mockReturnValue({ from: fromMock } as never);

    await processor({
      name: "check-debts",
      data: { maturity: 0, window: "1h" },
    } as unknown as Job<CheckDebtsData, unknown>);
    expect(mocks.add).toHaveBeenCalled();
  });
});
