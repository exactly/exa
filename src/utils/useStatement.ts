import { skipToken, useQuery } from "@tanstack/react-query";

import { getStatementActivity } from "./server";

export default function useStatement(maturity: number | undefined) {
  return useQuery({
    queryKey: ["activity", "statement", maturity],
    queryFn: maturity === undefined ? skipToken : () => getStatementActivity(maturity),
  });
}
