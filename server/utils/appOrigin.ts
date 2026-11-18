import { env } from "node:process";
import { array, parse, pipe, string, url } from "valibot";

import domain from "@exactly/common/domain";
import { domains } from "@exactly/common/rpId";
import tenants from "@exactly/common/tenants";

const appOrigin = domain === "localhost" ? "http://localhost:8081" : `https://${domain}`;
export default appOrigin;

export const origins = [
  ...new Set([
    appOrigin,
    ...parse(
      array(pipe(string(), url())),
      env.APP_ORIGINS?.split(",").flatMap((value) => (value.trim() ? [new URL(value.trim()).origin] : [])) ?? [],
    ),
  ]),
];

export const related = Object.entries(domains).flatMap(([host, id]) =>
  id === domain
    ? [`https://${host}`, ...Object.keys(tenants).filter((tenant) => new URL(tenant).host.endsWith(`.${host}`))]
    : [],
);

export function origin(request: Request) {
  const header = request.headers.get("origin");
  if (header !== null) return origins.includes(header) ? header : appOrigin;
  return origins.find((allowed) => new URL(allowed).host === new URL(request.url).host) ?? appOrigin;
}
