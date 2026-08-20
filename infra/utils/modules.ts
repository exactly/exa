export default define({
  common: ["redis-url", "sentry-dsn"],
  crema: ["redis-address", "redis-password", "redis-username"],
  workers: {
    hook: { secrets: ["panda-api-key", "postgres-url"], shared: ["panda-api-url"] },
    refund: {
      secrets: ["panda-api-key", "onesignal-api-key", "postgres-url", "sardine-api-key", "segment-write-key"],
      shared: ["panda-api-url", "sardine-api-url"],
      signers: ["refunder"],
    },
  },
});

function define<
  const Common extends readonly string[],
  const Crema extends readonly string[],
  const Services extends Configs = Configs,
  const Workers extends Configs = Configs,
>({
  common,
  crema,
  services,
  workers,
}: {
  readonly common: Common;
  readonly crema: Crema;
  readonly services?: Exact<Services>;
  readonly workers?: Exact<Workers>;
}): {
  readonly crema: Crema;
  readonly services: { readonly [Name in keyof Services]: Module<Name & string, Services[Name], Common> };
  readonly workers: { readonly [Name in keyof Workers]: Module<Name & string, Workers[Name], Common> };
};
function define({
  common,
  crema,
  services = {},
  workers = {},
}: {
  readonly common: readonly string[];
  readonly crema: readonly string[];
  readonly services?: Configs;
  readonly workers?: Configs;
}) {
  return { crema, services: modules(services, common), workers: modules(workers, common) };
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
