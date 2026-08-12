import { check, fallback, maxValue, minValue, object, optional, pipe, regex, string, transform } from "valibot";

import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { Address } from "@exactly/common/validation";
import { MATURITY_INTERVAL } from "@exactly/lib";

const digits = pipe(string(), regex(/^\d+$/));

const Loan = fallback(
  object({
    amount: optional(pipe(digits, transform<string, bigint>(BigInt), minValue(1n))),
    installments: optional(pipe(digits, transform(Number), minValue(1), maxValue(MAX_INSTALLMENTS))),
    market: optional(Address),
    maturity: optional(
      pipe(
        digits,
        transform<string, bigint>(BigInt),
        check((value) => value % BigInt(MATURITY_INTERVAL) === 0n),
      ),
    ),
    receiver: optional(Address),
  }),
  {},
);

export default Loan;
