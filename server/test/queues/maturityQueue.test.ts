import "../mocks/onesignal";
import "../mocks/sentry";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  marketAbi,
  marketUSDCAddress,
  marketWETHAddress,
  previewerAbi,
  previewerAddress,
} from "@exactly/common/generated/chain";
import { MATURITY_INTERVAL } from "@exactly/lib";

import * as onesignal from "../../utils/onesignal";

import type { CheckDebtsData } from "../../queues/maturityQueue";
import type { Job } from "bullmq";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  select: vi.fn(),
  readContract: vi.fn(),
  redisSet: vi.fn(),
}));

vi.mock("bullmq", () => {
  const mockAdd = mocks.add;
  class MockQueue {
    add = mockAdd;
  }
  class MockWorker {
    on = vi.fn().mockReturnThis();
  }
  return {
    Queue: MockQueue,
    Worker: MockWorker,
  };
});

vi.mock("../../utils/redis", () => ({
  default: {
    set: mocks.redisSet,
  },
}));

vi.mock("../../database", () => ({
  default: {
    select: mocks.select,
  },
  credentials: { account: "account" },
}));

vi.mock("../../utils/publicClient", () => ({
  default: {
    readContract: mocks.readContract,
  },
}));

function mockUsers(users: { account: string }[]) {
  const offsetMock = vi.fn().mockResolvedValueOnce(users).mockResolvedValueOnce([]);
  const limitMock = vi.fn().mockReturnValue({ offset: offsetMock });
  const fromMock = vi.fn().mockReturnValue({ limit: limitMock });
  mocks.select.mockReturnValue({ from: fromMock } as never);
}

describe("worker", () => {
  const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("schedules maturity checks", async () => {
    vi.stubEnv("DEBT_NOTIFICATION_IMPLEMENTATION", "market");
    vi.resetModules();
    const module_ = await import("../../queues/maturityQueue");
    const scheduleMaturityChecks = module_.scheduleMaturityChecks;

    await scheduleMaturityChecks();
    expect(mocks.add).toHaveBeenCalledTimes(2);
    expect(mocks.add).toHaveBeenCalledWith(
      "check-debts",
      expect.objectContaining({ window: "24h" }),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ jobId: expect.any(String) }),
    );
    expect(mocks.add).toHaveBeenCalledWith(
      "check-debts",
      expect.objectContaining({ window: "1h" }),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ jobId: expect.any(String) }),
    );
  });

  describe("previewer implementation", () => {
    let processor: (job: Job<CheckDebtsData, unknown>) => Promise<void>;

    beforeEach(async () => {
      vi.stubEnv("DEBT_NOTIFICATION_IMPLEMENTATION", "previewer");
      vi.resetModules();
      const module_ = await import("../../queues/maturityQueue");
      processor = module_.processor;
    });

    it("processes check-debts job with debt", async () => {
      const account = "0x1234567890123456789012345678901234567890";
      const maturity = 1_234_567_890;
      const window = "24h";

      mockUsers([{ account }]);

      mocks.readContract.mockResolvedValue([
        { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n } }] },
      ] as never);

      mocks.redisSet.mockResolvedValue("OK" as never);

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

      expect(mocks.redisSet).toHaveBeenCalledWith(
        `notification:sent:${account}:${maturity}:${window}`,
        expect.any(String),
        "EX",
        86_400,
        "NX",
      );
      expect(sendPushNotification).toHaveBeenCalledWith({
        userId: account,
        headings: { en: "Debt Maturity Alert" },
        contents: { en: "Your debt is due in 24 hours. Repay now to avoid liquidation." },
      });
    });

    it("handles empty debt", async () => {
      const account = "0x1234567890123456789012345678901234567890";
      const maturity = 1_234_567_890;

      mockUsers([{ account }]);

      mocks.readContract.mockResolvedValue([{ fixedBorrowPositions: [] }] as never);

      await processor({
        name: "check-debts",
        data: { maturity, window: "24h" },
      } as unknown as Job<CheckDebtsData, unknown>);

      expect(mocks.redisSet).not.toHaveBeenCalled();
      expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it("handles duplicate notification", async () => {
      const account = "0x1234567890123456789012345678901234567890";
      const maturity = 1_234_567_890;

      mockUsers([{ account }]);

      mocks.readContract.mockResolvedValue([
        { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n } }] },
      ] as never);

      mocks.redisSet.mockResolvedValue(null as never);

      await processor({
        name: "check-debts",
        data: { maturity, window: "24h" },
      } as unknown as Job<CheckDebtsData, unknown>);

      expect(mocks.redisSet).toHaveBeenCalled();
      expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it("uses previewer implementation when configured", async () => {
      const account = "0x1234567890123456789012345678901234567890";
      const maturity = 1_234_567_890;

      mockUsers([{ account }]);
      mocks.readContract.mockResolvedValue([{ fixedBorrowPositions: [] }] as never);

      await processor({
        name: "check-debts",
        data: { maturity, window: "24h" },
      } as unknown as Job<CheckDebtsData, unknown>);

      expect(mocks.readContract).toHaveBeenCalledWith({
        address: previewerAddress,
        abi: previewerAbi,
        functionName: "exactly",
        args: [account],
      });
    });
  });

  describe("market implementation", () => {
    let processor: (job: Job<CheckDebtsData, unknown>) => Promise<void>;

    beforeEach(async () => {
      vi.stubEnv("DEBT_NOTIFICATION_IMPLEMENTATION", "market");
      vi.resetModules();
      const module_ = await import("../../queues/maturityQueue");
      processor = module_.processor;
    });

    it("processes check-debts job with debt in single market", async () => {
      const account = "0x1234567890123456789012345678901234567890";
      const maturity = 1_234_567_890;
      const window = "24h";
      const baseMaturity = maturity;
      const encoded = BigInt(baseMaturity) | (1n << 32n);

      mockUsers([{ account }]);

      let callCount = 0;
      mocks.readContract.mockImplementation((args: { functionName?: string }) => {
        if (args.functionName === "accounts") {
          if (callCount === 0) {
            callCount++;
            return Promise.resolve([encoded, 0n, 0n] as never);
          }
          callCount++;
          return Promise.resolve([0n, 0n, 0n] as never);
        }
        return Promise.resolve([100n, 0n] as never);
      });

      mocks.redisSet.mockResolvedValue("OK" as never);

      await processor({
        name: "check-debts",
        data: { maturity, window },
      } as unknown as Job<CheckDebtsData, unknown>);

      expect(mocks.readContract).toHaveBeenCalledWith({
        address: marketUSDCAddress,
        abi: marketAbi,
        functionName: "accounts",
        args: [account],
      });
      expect(mocks.readContract).toHaveBeenCalledWith({
        address: marketWETHAddress,
        abi: marketAbi,
        functionName: "accounts",
        args: [account],
      });
      expect(mocks.redisSet).toHaveBeenCalledWith(
        `notification:sent:${account}:${maturity}:${window}`,
        expect.any(String),
        "EX",
        86_400,
        "NX",
      );
      expect(sendPushNotification).toHaveBeenCalledWith({
        userId: account,
        headings: { en: "Debt Maturity Alert" },
        contents: { en: "Your debt is due in 24 hours. Repay now to avoid liquidation." },
      });
    });

    it("handles bitmap with maturity but principal = 0", async () => {
      const account = "0x1234567890123456789012345678901234567890";
      const maturity = 1_234_567_890;
      const baseMaturity = maturity;
      const encoded = BigInt(baseMaturity) | (1n << 32n);

      mockUsers([{ account }]);

      let callCount = 0;
      mocks.readContract.mockImplementation(() => {
        if (callCount < 2) {
          callCount++;
          return Promise.resolve([encoded, 0n, 0n] as never);
        }
        return Promise.resolve([0n, 0n] as never);
      });

      await processor({
        name: "check-debts",
        data: { maturity, window: "24h" },
      } as unknown as Job<CheckDebtsData, unknown>);

      expect(mocks.redisSet).not.toHaveBeenCalled();
      expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it("handles user with no debt in any market", async () => {
      const account = "0x1234567890123456789012345678901234567890";
      const maturity = 1_234_567_890;

      mockUsers([{ account }]);

      mocks.readContract.mockResolvedValue([0n, 0n, 0n] as never);

      await processor({
        name: "check-debts",
        data: { maturity, window: "24h" },
      } as unknown as Job<CheckDebtsData, unknown>);

      expect(mocks.redisSet).not.toHaveBeenCalled();
      expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it("uses market implementation when configured", async () => {
      const account = "0x1234567890123456789012345678901234567890";
      const maturity = 1_234_567_890;

      mockUsers([{ account }]);
      mocks.readContract.mockResolvedValue([0n, 0n, 0n] as never);

      await processor({
        name: "check-debts",
        data: { maturity, window: "24h" },
      } as unknown as Job<CheckDebtsData, unknown>);

      expect(mocks.readContract).toHaveBeenCalledWith({
        address: marketUSDCAddress,
        abi: marketAbi,
        functionName: "accounts",
        args: [account],
      });
      expect(mocks.readContract).toHaveBeenCalledWith({
        address: marketWETHAddress,
        abi: marketAbi,
        functionName: "accounts",
        args: [account],
      });
    });
  });

  it("reschedules on 1h window", async () => {
    vi.stubEnv("DEBT_NOTIFICATION_IMPLEMENTATION", "market");
    vi.resetModules();
    const module_ = await import("../../queues/maturityQueue");
    const processor = module_.processor;

    const jobMaturity = MATURITY_INTERVAL * 10;

    const offsetMock = vi.fn().mockResolvedValueOnce([]);
    const limitMock = vi.fn().mockReturnValue({ offset: offsetMock });
    const fromMock = vi.fn().mockReturnValue({ limit: limitMock });
    mocks.select.mockReturnValue({ from: fromMock } as never);
    mocks.readContract.mockResolvedValue([0n, 0n, 0n] as never);

    await processor({
      name: "check-debts",
      data: { maturity: jobMaturity, window: "1h" },
    } as unknown as Job<CheckDebtsData, unknown>);

    const expectedNextMaturity = jobMaturity + MATURITY_INTERVAL;
    expect(mocks.add).toHaveBeenCalledWith(
      "check-debts",
      expect.objectContaining({ maturity: expectedNextMaturity, window: "24h" }),
      expect.objectContaining({ jobId: `check-debts-${String(expectedNextMaturity)}-24h` }),
    );
    expect(mocks.add).toHaveBeenCalledWith(
      "check-debts",
      expect.objectContaining({ maturity: expectedNextMaturity, window: "1h" }),
      expect.objectContaining({ jobId: `check-debts-${String(expectedNextMaturity)}-1h` }),
    );
  });
});
