import domain from "./domain";
import tenants from "./tenants";

export default (tenants[`https://${(globalThis as { location?: { host: string } }).location?.host ?? domain}`] ??
  "") !== "";
