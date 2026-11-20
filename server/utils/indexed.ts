import { captureException } from "@sentry/node";

import listen from "./listen";

import type { Pool } from "pg";

export default function indexed(pool: Pool) {
  const waiting = new Map<string, { block: bigint; chainId: number; run: () => void }>();
  const listener = listen(pool, check, { listener: "indexed" });
  return {
    ready: listener.ready,
    close: () => listener.close(),
    after(key: string, chainId: number, block: bigint, run: () => void) {
      const current = waiting.get(key);
      waiting.set(key, { block: current && current.block > block ? current.block : block, chainId, run });
      check().catch((error: unknown) => {
        captureException(error, { level: "error" });
        flush(() => true);
      });
    },
  };

  async function check() {
    if (waiting.size === 0) return;
    const { rows } = await pool.query<{ chain_id: string; latest_checkpoint: string }>(
      "select chain_id, latest_checkpoint from indexer._ponder_checkpoint",
    );
    const blocks = new Map(rows.map((row) => [Number(row.chain_id), BigInt(row.latest_checkpoint.slice(26, 42))]));
    flush(({ block, chainId }) => {
      const latest = blocks.get(chainId);
      return latest === undefined || latest >= block;
    });
  }

  function flush(ready: (entry: { block: bigint; chainId: number }) => boolean) {
    for (const [key, entry] of waiting) {
      if (!ready(entry)) continue;
      waiting.delete(key);
      entry.run();
    }
  }
}
