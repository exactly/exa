import "../../instrument.cjs";

import { close } from "@sentry/node";
import { afterAll } from "vitest";

afterAll(() => close());
