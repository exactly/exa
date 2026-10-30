import domain from "./domain";
import tenants from "./tenants";

const { location } = globalThis as { location?: { host: string } };

export default (tenants[`https://${location?.host ?? domain}`] ?? "") !== "";
