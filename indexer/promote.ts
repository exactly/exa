import { spawnSync } from "node:child_process";
import { argv, env } from "node:process";
import { setTimeout } from "node:timers/promises";
import pg from "pg";

const dropped = new Set<string>();

const [schema] = argv.slice(2);
if (!schema) throw new Error("usage: node promote.ts <schema>");
const views = "indexer";

const client = new pg.Client({ connectionString: env.POSTGRES_URL });
const meta = `${client.escapeIdentifier(schema)}._ponder_meta`;
await client.connect();
try {
  while (!(await ready())) await setTimeout(1000);
  await client.query("select pg_advisory_lock(hashtext($1))", [views]); // cspell:ignore hashtext
  const previous = await target();
  const { rows: missing } = await client.query<{ column_name: string; table_name: string }>(
    String.raw`select table_name, column_name from information_schema.columns live
      where table_schema = $1 and table_name not like '\_ponder%' and not exists (
        select from information_schema.columns candidate
        where candidate.table_schema = $2
          and candidate.table_name = live.table_name
          and candidate.column_name = live.column_name
          and candidate.data_type = live.data_type
          and candidate.udt_name = live.udt_name
      )`,
    [views, schema],
  );
  const breaking = missing
    .map(({ table_name, column_name }) => [table_name, `${table_name}.${column_name}`] as const)
    .filter(([table, column]) => !dropped.has(table) && !dropped.has(column));
  if (breaking.length > 0) throw new Error(`${schema} lacks ${breaking.map(([, column]) => column).join(", ")}`);
  const { status } = spawnSync(
    "node_modules/.bin/ponder",
    ["db", "create-views", "--schema", schema, "--views-schema", views],
    { stdio: "inherit" },
  );
  if (status !== 0) throw new Error(`create-views exited with ${status}`);
  const live = await target();
  if (live.length !== 1 || live[0] !== schema) throw new Error(`views point to ${live.join(", ")}, not ${schema}`);
  const { rows: deployments } = await client.query<{ table_schema: string }>(
    "select table_schema from information_schema.tables where table_name = '_ponder_meta' and table_type = 'BASE TABLE'",
  );
  for (const { table_schema: stale } of deployments) {
    if (stale === schema || previous.includes(stale)) continue;
    await client.query(`drop schema ${client.escapeIdentifier(stale)} cascade`);
  }
} finally {
  await client.end();
}

async function ready() {
  const { rows } = await client
    .query<{
      ready: boolean;
    }>(`select value->>'is_ready' = '1' as ready from ${meta} where key = 'app'`)
    .catch((error: unknown) => {
      if (error instanceof pg.DatabaseError && (error.code === "3F000" || error.code === "42P01")) return { rows: [] };
      throw error;
    });
  return rows[0]?.ready === true;
}

async function target() {
  const { rows } = await client.query<{ table_schema: string }>(
    String.raw`select distinct table_schema from information_schema.view_table_usage where view_schema = $1 and table_name not like '\_ponder%'`,
    [views],
  );
  return rows.map(({ table_schema }) => table_schema);
}
