import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { Redis } from "ioredis";
import { env } from "node:process";
import { array, optional, parse, picklist, pipe, string, transform } from "valibot";

import api from ".";
import * as schema from "../database/schema";
import supervise, { own } from "../supervise";
import createIntercom from "../utils/intercom";
import createPanda from "../utils/panda";
import createPax from "../utils/pax";
import createPersona from "../utils/persona";
import createBridge from "../utils/ramps/bridge";
import createManteca from "../utils/ramps/manteca";
import createSardine from "../utils/sardine";
import secret from "../utils/secret";
import createSegment from "../utils/segment";
import createWalletExtension from "../utils/walletExtension";
import createCredit from "../workers/credit/queue";
import createSubscribe from "../workers/subscribe/queue";

const secrets = new SecretManagerServiceClient();

supervise(
  "api",
  Promise.all([
    secret("redis-url", secrets).then((url) => {
      const redis = new Redis(url);
      return [redis, createCredit(redis), createSubscribe(redis)] as const;
    }),
    secret("api-auth-secret", secrets),
    Promise.all([secret("api-bridge-api-key", secrets), secret("bridge-api-url", secrets)]).then(([key, url]) =>
      createBridge(key, url),
    ),
    Promise.resolve(
      !parse(
        pipe(
          optional(string(), ""),
          transform((value) => value.split(",").filter(Boolean)),
          array(picklist(["business"], "unknown module")),
        ),
        env.DISABLED_MODULES,
      ).includes("business"),
    ),
    secret("api-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    secret("api-intercom-identity-key", secrets).then((key) => createIntercom(key)),
    Promise.all([secret("api-manteca-api-key", secrets), secret("manteca-api-url", secrets)]).then(([key, url]) =>
      createManteca(key, url),
    ),
    Promise.all([secret("api-panda-api-key", secrets), secret("panda-api-url", secrets)]).then(([key, url]) =>
      createPanda({ key, url }),
    ),
    Promise.all([
      secret("api-pax-associate-id-key", secrets),
      secret("api-pax-api-key", secrets),
      secret("pax-api-url", secrets),
    ]).then(([associateKey, key, url]) => createPax({ associateKey, key, url })),
    Promise.all([secret("api-persona-api-key", secrets), secret("persona-api-url", secrets)]).then(([key, url]) =>
      createPersona(key, url),
    ),
    Promise.all([secret("api-sardine-api-key", secrets), secret("sardine-api-url", secrets)]).then(([key, url]) =>
      createSardine(key, url),
    ),
    secret("api-segment-write-key", secrets).then((key) => createSegment(key)),
    secret("api-wallet-extension-secret", secrets).then((value) => createWalletExtension(value)),
  ]).then(
    ([
      [redis, credit, subscribe],
      authSecret,
      bridge,
      business,
      database,
      intercom,
      manteca,
      panda,
      pax,
      persona,
      sardine,
      segment,
      walletExtension,
    ]) => {
      const { app, ready } = api({
        authSecret,
        bridge,
        business,
        credit,
        database,
        intercom,
        manteca,
        panda,
        pax,
        persona,
        redis,
        sardine,
        segment,
        subscribe,
        walletExtension,
      });
      return own(
        { app: new Hono().route("/api", app), ready },
        () => database.$client.end(),
        () => secrets.close(),
        () => segment.close(),
        () => Promise.all([credit.close(), subscribe.close()]).finally(() => redis.quit()),
      );
    },
  ),
);
