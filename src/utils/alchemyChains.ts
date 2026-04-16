import * as accountKitInfra from "@account-kit/infra";

import type { Chain } from "viem";

export default new Map(
  Object.values(accountKitInfra)
    .filter((c): c is Chain => typeof c === "object" && "id" in c && typeof c.id === "number")
    .map((c) => [c.id, c]),
);
