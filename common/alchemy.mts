import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { array, boolean, integer, minValue, nullish, number, object, parse, pipe, regex, string } from "valibot";

const { result } = parse(
  object({
    result: object({
      data: array(
        object({
          availability: string(),
          isTestNet: boolean(),
          kebabCaseId: pipe(string(), regex(/^[a-z\d]+(?:-[a-z\d]+)*$/)),
          networkChainId: nullish(pipe(number(), integer(), minValue(1))),
          supportedProducts: array(string()),
        }),
      ),
    }),
  }),
  await fetch("https://app-api.alchemy.com/trpc/config.getNetworkConfig").then((response) => response.json()),
);
const json = `${JSON.stringify(
  Object.fromEntries(
    result.data.flatMap(({ availability, isTestNet, kebabCaseId, networkChainId, supportedProducts }) =>
      networkChainId &&
      !isTestNet &&
      kebabCaseId.endsWith("-mainnet") &&
      availability === "public" &&
      supportedProducts.includes("node-api")
        ? [[networkChainId, kebabCaseId] as const]
        : [],
    ),
  ),
  null,
  2,
)}\n`;
if (!existsSync("alchemy.json") || readFileSync("alchemy.json", "utf8") !== json) {
  if (process.argv.includes("--check")) {
    console.error("alchemy networks changed, run generate:alchemy"); // eslint-disable-line no-console -- cli output
    process.exitCode = 1;
  } else {
    writeFileSync("alchemy.json", json);
    writeFileSync(
      "../.changeset/alchemy-networks.md",
      `---\n"@exactly/common": patch\n---\n\n🔧 update alchemy networks\n`,
    );
  }
}
