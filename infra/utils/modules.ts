const common = ["redis-url", "sentry-dsn"] as const;

export default {
  crema: ["redis-address", "redis-password", "redis-username"],
  services: modules({
    api: {
      secrets: [
        "alchemy-webhooks-key",
        "auth-secret",
        "bridge-api-key",
        "intercom-identity-key",
        "manteca-api-key",
        "panda-api-key",
        "pax-associate-id-key",
        "pax-api-key",
        "persona-api-key",
        "postgres-url",
        "sardine-api-key",
        "segment-write-key",
        "wallet-extension-secret",
      ],
      shared: [
        "bridge-api-url",
        "manteca-api-url",
        "panda-api-url",
        "pax-api-url",
        "persona-api-url",
        "sardine-api-url",
      ],
    },
    activity: { secrets: ["alchemy-webhooks-key", "onesignal-api-key", "postgres-url"] },
    block: { secrets: ["alchemy-webhooks-key", "onesignal-api-key"], signer: "executor" },
    bridge: {
      secrets: ["bridge-api-key", "onesignal-api-key", "persona-api-key", "postgres-url", "segment-write-key"],
      shared: ["bridge-api-url", "persona-api-url"],
    },
    manteca: {
      secrets: ["manteca-api-key", "webhooks-key", "onesignal-api-key", "postgres-url", "segment-write-key"],
      shared: ["manteca-api-url"],
    },
    panda: {
      secrets: [
        "issuer-private-key",
        "onesignal-api-key",
        "panda-api-key",
        "postgres-url",
        "sardine-api-key",
        "segment-write-key",
      ],
      shared: ["panda-api-url", "sardine-api-url"],
      signer: "settler",
    },
    persona: {
      secrets: [
        "panda-api-key",
        "pax-associate-id-key",
        "pax-api-key",
        "persona-api-key",
        "persona-webhook-secret",
        "postgres-url",
        "sardine-api-key",
      ],
      shared: ["panda-api-url", "pax-api-url", "persona-api-url", "sardine-api-url"],
    },
  } as const satisfies Record<string, Config>),
  workers: modules({
    allow: { secrets: [], signer: "allower" },
    credit: { secrets: ["onesignal-api-key", "postgres-url"] },
    poke: { secrets: ["onesignal-api-key", "segment-write-key"], signer: "poker" },
    refund: { secrets: ["panda-api-key"], shared: ["panda-api-url"], signer: "refunder" },
    subscribe: { env: { ALCHEMY_ACTIVITY_ID: "alchemyActivityId" }, secrets: ["alchemy-webhooks-key"] },
  } as const satisfies Record<string, Config>),
} as const;

function modules<const Specs extends Readonly<Record<string, Config>>>(
  specs: Specs,
): { readonly [Name in keyof Specs]: Module<Name & string, Specs[Name]> };
function modules(specs: Readonly<Record<string, Config>>): Readonly<Record<string, Config>> {
  return Object.fromEntries(
    Object.entries(specs).map(([name, { env, secrets, shared = [], signer, ...config }]) => [
      name,
      {
        ...config,
        env,
        secrets: [...secrets.map((secret) => `${name}-${secret}`), ...shared, ...common],
        signer,
      },
    ]),
  );
}

type Config = {
  readonly env?: Readonly<Record<string, string>>;
  readonly secrets: readonly string[];
  readonly shared?: readonly string[];
  readonly signer?: string;
};
type Module<Name extends string, Spec extends Config> = Omit<Spec, "env" | "secrets" | "shared" | "signer"> & {
  readonly env: Spec extends { readonly env: infer Environment extends NonNullable<Config["env"]> }
    ? Environment
    : undefined;
  readonly secrets: readonly [
    ...(Spec["secrets"] extends infer Secrets extends readonly string[]
      ? {
          readonly [Index in keyof Secrets]: Secrets[Index] extends string ? `${Name}-${Secrets[Index]}` : never;
        }
      : readonly []),
    ...(Spec extends { readonly shared: infer Shared extends readonly string[] } ? Shared : readonly []),
    ...typeof common,
  ];
  readonly signer: Spec extends { readonly signer: infer Signer extends NonNullable<Config["signer"]> }
    ? Signer
    : undefined;
} extends infer Result
  ? { [Key in keyof Result]: Result[Key] } & {}
  : never;
