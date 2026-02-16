const scope = "scoped:";
const common = ["redis-url", "sentry-dsn"] as const;

export default {
  crema: ["redis-address", "redis-password", "redis-username"],
  workers: {
    refund: worker("refund", { secrets: [scoped("panda-api-key"), shared("panda-api-url")], signer: "refunder" }),
    subscribe: worker("subscribe", {
      env: { ALCHEMY_ACTIVITY_ID: "alchemyActivityId" },
      secrets: [scoped("alchemy-webhooks-key")],
    }),
  },
} as const;

function worker<const Name extends string, const Spec extends Config>(
  name: Name,
  spec: Spec,
): Omit<Spec, "env" | "secrets" | "signer"> & {
  readonly env: Resource["env"];
  readonly secrets: readonly [
    ...(Spec["secrets"] extends infer Secrets extends readonly string[]
      ? {
          readonly [Index in keyof Secrets]: Secrets[Index] extends `${typeof scope}${infer Secret}`
            ? `${Name}-${Secret}`
            : Secrets[Index];
        }
      : readonly []),
    ...typeof common,
  ];
  readonly signer: Resource["signer"];
} extends infer Result
  ? { [Key in keyof Result]: Result[Key] } & {}
  : never;
function worker(name: string, { env, secrets, signer, ...spec }: Config): Resource {
  return {
    ...spec,
    env,
    secrets: [
      ...secrets.map((secret) => (secret.startsWith(scope) ? `${name}-${secret.slice(scope.length)}` : secret)),
      ...common,
    ],
    signer,
  };
}

function scoped<const Name extends string>(name: Name): `${typeof scope}${Name}` {
  return `${scope}${name}`;
}

function shared<const Name extends string>(name: Name): Name {
  return name;
}

type Config = { env?: Readonly<Record<string, string>>; secrets: readonly string[]; signer?: string };
type Resource = { env: Config["env"]; secrets: Config["secrets"]; signer: Config["signer"] };
