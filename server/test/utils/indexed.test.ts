import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import database from "../../database";
import indexed from "../../utils/indexed";
import anvilClient from "../anvilClient";

const pool = database.$client;
const query = pool.query.bind(pool) as (text: string) => Promise<unknown>;

describe("indexed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the indexed block from the checkpoint", async () => {
    const indexer = indexed(pool);
    await indexer.ready;
    const later = vi.fn();
    const earlier = vi.fn();

    indexer.after("later", 31_337, (await anvilClient.getBlockNumber()) + 1000n, later);
    indexer.after("earlier", 31_337, 1n, earlier);

    await vi.waitFor(() => expect(earlier).toHaveBeenCalledOnce());
    expect(later).not.toHaveBeenCalled();
    await indexer.close();
  });

  it("runs once the indexer has the block", async () => {
    const reads = mockCheckpoints(5n);
    const indexer = indexed(pool);
    await indexer.ready;
    const run = vi.fn();

    indexer.after("account", 31_337, 6n, run);
    await vi.waitFor(() => expect(reads).toHaveBeenCalledWith(expect.stringContaining("_ponder_checkpoint")));
    expect(run).not.toHaveBeenCalled();
    mockCheckpoints(6n);
    await pool.query(`NOTIFY "indexer_live_query"`);

    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await indexer.close();
  });

  it("runs right away when the indexer is already past the block", async () => {
    mockCheckpoints(9n);
    const indexer = indexed(pool);
    await indexer.ready;
    const run = vi.fn();

    indexer.after("account", 31_337, 6n, run);

    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await indexer.close();
  });

  it("runs right away on chains the indexer does not cover", async () => {
    mockCheckpoints(0n);
    const indexer = indexed(pool);
    await indexer.ready;
    const run = vi.fn();

    indexer.after("account", 10, 6n, run);

    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await indexer.close();
  });

  it("waits for the latest block of each key", async () => {
    mockCheckpoints(5n);
    const indexer = indexed(pool);
    await indexer.ready;
    const first = vi.fn();
    const second = vi.fn();

    indexer.after("account", 31_337, 8n, first);
    indexer.after("account", 31_337, 7n, second);
    const reads = mockCheckpoints(7n);
    await pool.query(`NOTIFY "indexer_live_query"`);
    await vi.waitFor(() => expect(reads).toHaveBeenCalledWith(expect.stringContaining("_ponder_checkpoint")));
    expect(second).not.toHaveBeenCalled();
    mockCheckpoints(8n);
    await pool.query(`NOTIFY "indexer_live_query"`);

    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
    expect(first).not.toHaveBeenCalled();
    await indexer.close();
  });

  it("runs everything when the indexer can not be read", async () => {
    const indexer = indexed(pool);
    await indexer.ready;
    const error = new Error("down");
    vi.spyOn(pool as { query: (text: string) => Promise<unknown> }, "query").mockRejectedValueOnce(error);
    const run = vi.fn();

    indexer.after("account", 31_337, 6n, run);

    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(captureException).toHaveBeenCalledWith(error, { level: "error" });
    await indexer.close();
  });
});

function mockCheckpoints(block: bigint) {
  const checkpoint = `1700000000${"31337".padStart(16, "0")}${String(block).padStart(16, "0")}${"0".repeat(33)}`;
  return vi
    .spyOn(pool as { query: (text: string) => Promise<unknown> }, "query")
    .mockImplementation((text) =>
      text.includes("_ponder_checkpoint")
        ? Promise.resolve({ rows: [{ chain_id: "31337", latest_checkpoint: checkpoint }] })
        : query(text),
    );
}
