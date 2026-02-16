import "../../instrument.cjs";

import { close } from "@sentry/node";
import { afterAll, vi } from "vitest";

vi.mock("@sentry/node", { spy: true });

afterAll(() => close());
