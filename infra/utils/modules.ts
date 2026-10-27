export default define({
  common: ["sentry-dsn"],
  crema: ["redis-address", "redis-password", "redis-username"],
  features: ["business"],
  services: {
    api: {
      secrets: [
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
        "redis-url",
        "sardine-api-url",
      ],
    },
    activity: { secrets: ["alchemy-webhooks-key", "onesignal-api-key", "postgres-url"], shared: ["redis-url"] },
    block: {
      secrets: ["alchemy-block-key", "alchemy-webhooks-key", "onesignal-api-key"],
      shared: ["redis-url"],
      signers: ["executor"],
    },
    bridge: {
      secrets: [
        "bridge-api-key",
        "onesignal-api-key",
        "persona-api-key",
        "postgres-url",
        "segment-write-key",
        "webhook-public-key",
      ],
      shared: ["bridge-api-url", "persona-api-url"],
    },
    chat: {
      env: { WHATSAPP_PHONE_NUMBER_ID: "whatsappPhoneNumberId" },
      secrets: ["whatsapp-app-secret", "whatsapp-verify-token"],
      shared: ["redis-url"],
    },
    manteca: {
      secrets: ["manteca-api-key", "onesignal-api-key", "postgres-url", "segment-write-key", "webhooks-key"],
      shared: ["manteca-api-url"],
    },
    panda: {
      secrets: [
        "onesignal-api-key",
        "panda-api-key",
        "postgres-url",
        "sardine-api-key",
        "segment-write-key",
        "webhooks-key",
      ],
      shared: ["panda-api-url", "redis-url", "sardine-api-url"],
      signers: ["settler", "issuer"],
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
      shared: ["panda-api-url", "pax-api-url", "persona-api-url", "redis-url", "sardine-api-url"],
    },
    sponsor: { secrets: ["postgres-url", "token"] },
  },
  workers: {
    allow: { shared: ["redis-url"], signers: ["allower"] },
    chat: {
      env: { WHATSAPP_PHONE_NUMBER_ID: "whatsappPhoneNumberId" },
      secrets: ["anthropic-api-key", "whatsapp-access-token"],
      shared: ["redis-url"],
    },
    credit: { secrets: ["onesignal-api-key", "postgres-url"], shared: ["redis-url"] },
    hook: { secrets: ["panda-api-key", "postgres-url"], shared: ["panda-api-url", "redis-url"] },
    poke: { secrets: ["onesignal-api-key", "segment-write-key"], shared: ["redis-url"], signers: ["poker"] },
    refund: {
      secrets: ["panda-api-key", "onesignal-api-key", "postgres-url", "sardine-api-key", "segment-write-key"],
      shared: ["panda-api-url", "redis-url", "sardine-api-url"],
      signers: ["refunder"],
    },
    subscribe: { secrets: ["alchemy-webhooks-key", "postgres-url"], shared: ["redis-url"] },
  },
});

function define<
  const Common extends readonly string[],
  const Crema extends readonly string[],
  const Features extends readonly string[],
  const Services extends Configs = Configs,
  const Workers extends Configs = Configs,
>({
  common,
  crema,
  features,
  services,
  workers,
}: {
  readonly common: Common;
  readonly crema: Crema;
  readonly features: Features;
  readonly services?: Exact<Services>;
  readonly workers?: Exact<Workers>;
}): {
  readonly crema: Crema;
  readonly features: Features;
  readonly services: { readonly [Name in keyof Services]: Module<Name & string, Services[Name], Common> };
  readonly workers: { readonly [Name in keyof Workers]: Module<Name & string, Workers[Name], Common> };
};
function define({
  common,
  crema,
  features,
  services = {},
  workers = {},
}: {
  readonly common: readonly string[];
  readonly crema: readonly string[];
  readonly features: readonly string[];
  readonly services?: Configs;
  readonly workers?: Configs;
}) {
  return { crema, features, services: modules(services, common), workers: modules(workers, common) };
}

function modules(specs: Configs, common: readonly string[]) {
  return Object.fromEntries(
    Object.entries(specs).map(([name, { env = {}, secrets = [], shared = [], signers = [] }]) => [
      name,
      { env, secrets: [...secrets.map((secret) => `${name}-${secret}`), ...shared, ...common], signers },
    ]),
  );
}

type Config = {
  readonly env?: Readonly<Record<string, string>>;
  readonly secrets?: readonly string[];
  readonly shared?: readonly string[];
  readonly signers?: readonly string[];
};
type Configs = Readonly<Record<string, Config>>;
type Exact<Specs extends Configs> = Specs & {
  readonly [Name in keyof Specs]: Record<Exclude<keyof Specs[Name], keyof Config>, never>;
};
type Module<Name extends string, Spec extends Config, Common extends readonly string[]> = {
  readonly env: NonNullable<Config["env"]>;
  readonly secrets: readonly [
    ...(Spec["secrets"] extends infer Secrets extends readonly string[]
      ? { readonly [Index in keyof Secrets]: Secrets[Index] extends string ? `${Name}-${Secrets[Index]}` : never }
      : readonly []),
    ...(Spec extends { readonly shared: infer Shared extends readonly string[] } ? Shared : readonly []),
    ...Common,
  ];
  readonly signers: NonNullable<Config["signers"]>;
} extends infer Result
  ? { [Key in keyof Result]: Result[Key] } & {}
  : never;
