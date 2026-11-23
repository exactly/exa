import { Hono } from "hono";
import { getMimeType } from "hono/utils/mime";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "node:process";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { array, object, parse, picklist, record, string } from "valibot";

const run = promisify(execFile);
const Platform = picklist(["android", "ios"]);
const Metadata = object({
  fileMetadata: record(
    string(),
    object({ bundle: string(), assets: array(object({ path: string(), ext: string() })) }),
  ),
});

const output = path.join(tmpdir(), "exa-updates");

export default function updates(root: string) {
  const exports = new Map<string, Promise<Awaited<ReturnType<typeof exportUpdate>>>>();
  const bundles = new Map<string, Promise<{ data: Uint8Array; hash: string; id: string }>>();
  const published: string[] = [];
  let generation = 0;
  const downloads = new Map<number, PromiseWithResolvers<void>>();
  const launches = new Map<number, PromiseWithResolvers<void>>();
  const updateIds = new Map<string, number>();

  function exported(domain: string, platform: string) {
    const key = `${domain}/${platform}`;
    let promise = exports.get(key);
    if (!promise) {
      promise = exportUpdate(root, domain, parse(Platform, platform));
      promise.catch(() => null);
      exports.set(key, promise);
    }
    return promise;
  }

  function bundle(domain: string, platform: string, n: number) {
    const key = `${domain}/${platform}/${n}`;
    let promise = bundles.get(key);
    if (!promise) {
      promise = exported(domain, platform).then(({ release, source }) => {
        const data = new TextEncoder().encode(source.replaceAll(release, marker(release, n)));
        const id = crypto.randomUUID();
        updateIds.set(id, n);
        return { data, hash: sha256(data), id };
      });
      promise.catch(() => bundles.delete(key));
      bundles.set(key, promise);
    }
    return promise;
  }

  function downloaded(n: number) {
    let download = downloads.get(n);
    if (!download) {
      download = Promise.withResolvers();
      downloads.set(n, download);
    }
    return download;
  }

  function launched(n: number) {
    let launch = launches.get(n);
    if (!launch) {
      launch = Promise.withResolvers();
      launches.set(n, launch);
    }
    return launch;
  }

  function within(promise: Promise<unknown>, timeout: number) {
    return Promise.race([
      promise.then(
        () => true,
        () => false,
      ),
      setTimeout(timeout, false),
    ]);
  }

  return new Hono()
    .post("/reset", async (c) => {
      generation += 1;
      published.length = 0;
      for (const map of [exports, bundles, downloads, launches, updateIds]) map.clear();
      await rm(output, { recursive: true, force: true });
      return c.json({ code: "ok" });
    })
    .post("/", async (c) => {
      if (exports.size === 0) return c.json({ code: "no client" }, 409);
      const started = generation;
      const ready = await Promise.all(exports.values());
      if (started !== generation) return c.json({ code: "reset" }, 409);
      const releases = new Set(ready.map(({ release }) => release));
      if (releases.size !== 1) return c.json({ code: "mixed releases" }, 409);
      published.push(new Date().toISOString());
      return c.json({ n: published.length, release: marker([...releases][0] ?? "", published.length) });
    })
    .get("/downloaded", async (c) =>
      (await within(downloaded(Number(c.req.query("n"))).promise, 60_000))
        ? c.json({ code: "ok" })
        : c.json({ code: "not downloaded" }, 404),
    )
    .get("/launched", async (c) =>
      (await within(launched(Number(c.req.query("n"))).promise, Number(c.req.query("timeout") ?? 60_000)))
        ? c.json({ code: "ok" })
        : c.json({ code: "not launched" }, 404),
    )
    .get("/:domain", async (c) => {
      const domain = c.req.param("domain");
      const platform = c.req.header("expo-platform") ?? "";
      const current = updateIds.get(c.req.header("expo-current-update-id")?.toLowerCase() ?? "");
      if (current !== undefined) launched(current).resolve();
      exported(domain, platform).catch(() => null);
      const n = published.length;
      const createdAt = published.at(-1);
      if (!createdAt) return c.body(null, 204, { "expo-protocol-version": "1", "expo-sfv-version": "0" });
      const [{ assets, config }, { hash, id }] = await Promise.all([
        exported(domain, platform),
        bundle(domain, platform, n),
      ]);
      const base = `${new URL(c.req.url).origin}/e2e/updates/${domain}/${platform}`;
      const manifest = {
        id,
        createdAt,
        runtimeVersion: c.req.header("expo-runtime-version"),
        launchAsset: {
          hash,
          key: id,
          contentType: "application/javascript",
          fileExtension: ".bundle",
          url: `${base}/${n}/bundle`,
        },
        assets: assets.map(({ file, ext, hash: assetHash }) => ({
          hash: assetHash,
          key: file,
          contentType: getMimeType(`asset.${ext}`) ?? "application/octet-stream",
          fileExtension: `.${ext}`,
          url: `${base}/assets/${file}`,
        })),
        metadata: {},
        extra: { expoClient: config },
      };
      const boundary = crypto.randomUUID();
      return c.body(
        `--${boundary}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-disposition: form-data; name="manifest"\r\n\r\n${JSON.stringify(manifest)}\r\n--${boundary}--\r\n`,
        200,
        {
          "content-type": `multipart/mixed; boundary=${boundary}`,
          "expo-protocol-version": "1",
          "expo-sfv-version": "0",
          "cache-control": "private, max-age=0",
        },
      );
    })
    .get("/:domain/:platform/assets/:file", async (c) => {
      const file = c.req.param("file");
      if (!/^\w+$/.test(file)) return c.json({ code: "bad asset" }, 400);
      const { directory } = await exported(c.req.param("domain"), c.req.param("platform"));
      return c.body(await readFile(path.join(directory, "assets", file))); // eslint-disable-line security/detect-non-literal-fs-filename -- exported asset
    })
    .get("/:domain/:platform/:n/bundle", async (c) => {
      const n = Number(c.req.param("n"));
      const { data } = await bundle(c.req.param("domain"), c.req.param("platform"), n);
      let sent = false;
      return c.body(
        new ReadableStream({
          pull(controller) {
            if (sent) {
              downloaded(n).resolve();
              controller.close();
              return;
            }
            sent = true;
            controller.enqueue(data);
          },
        }),
        200,
        { "content-type": "application/javascript" },
      );
    });
}

function marker(release: string, n: number) {
  return `${release}+${n}`;
}

async function exportUpdate(root: string, domain: string, platform: "android" | "ios") {
  await mkdir(output, { recursive: true }); // eslint-disable-line security/detect-non-literal-fs-filename -- export output
  const directory = await mkdtemp(path.join(output, `${domain}-${platform}-`));
  const { NODE_ENV, EXPO_PUBLIC_ALCHEMY_API_KEY, ...rest } = env;
  const options = {
    cwd: root,
    env: { ...rest, APP_DOMAIN: domain, EXPO_PUBLIC_ENV: "e2e", EXPO_NO_TELEMETRY: "1" },
    maxBuffer: 1 << 26,
  };
  await run(
    "pnpm",
    ["exec", "expo", "export", "--platform", platform, "--no-bytecode", "--output-dir", directory],
    options,
  );
  const [{ stdout: config }, metadata, generated] = await Promise.all([
    run("pnpm", ["exec", "expo", "config", "--type", "public", "--json"], options),
    readFile(path.join(directory, "metadata.json"), "utf8"), // eslint-disable-line security/detect-non-literal-fs-filename -- export output
    readFile(path.join(root, "src/generated/release.js"), "utf8"), // eslint-disable-line security/detect-non-literal-fs-filename -- generated release
  ]);
  const release = /'([^']+)'/.exec(generated)?.[1];
  if (!release) throw new Error("no release");
  const files = parse(Metadata, JSON.parse(metadata)).fileMetadata[platform];
  if (!files) throw new Error(`no ${platform} export`);
  const source = await readFile(path.join(directory, files.bundle), "utf8"); // eslint-disable-line security/detect-non-literal-fs-filename -- export output
  if (!source.includes(release)) throw new Error(`release ${release} not in bundle`);
  return {
    directory,
    config: JSON.parse(config) as unknown,
    release,
    source,
    assets: await Promise.all(
      files.assets.map(async ({ path: file, ext }) => ({
        file: path.basename(file),
        ext,
        hash: sha256(await readFile(path.join(directory, file))), // eslint-disable-line security/detect-non-literal-fs-filename -- export output
      })),
    ),
  };
}

function sha256(data: crypto.BinaryLike) {
  return crypto.createHash("sha256").update(data).digest("base64url");
}
