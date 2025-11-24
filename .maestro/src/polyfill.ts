// @ts-expect-error -- missing type module
import { TextDecoder, TextEncoder } from "fast-text-encoding";

globalThis.TextDecoder = TextDecoder; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
globalThis.TextEncoder = TextEncoder; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
