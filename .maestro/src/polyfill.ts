// @ts-expect-error -- missing type module
import { TextEncoder } from "fast-text-encoding";

globalThis.TextEncoder = TextEncoder; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
