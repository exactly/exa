import * as readline from "node:readline";

/** minimal protobuf cursor to navigate fields without full decoding. */
class ProtoCursor {
  private buffer: Buffer;
  private offset: number;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  readVarint() {
    let result = BigInt(0);
    let shift = 0n;
    let byte = 0;

    do {
      if (this.offset >= this.buffer.length) throw new Error("Varint out of bounds");
      byte = this.buffer[this.offset++]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      result += BigInt(byte & 0x7f) << shift;
      shift += 7n;
    } while (byte >= 0x80);

    return result;
  }

  readTag() {
    if (this.offset >= this.buffer.length) return null;
    const tag = this.readVarint(); // cspell:ignore varint
    return { fieldNumber: Number(tag >> 3n), wireType: Number(tag & 7n) };
  }

  skip(wireType: number) {
    switch (wireType) {
      case 0:
        // varint
        this.readVarint();
        break;
      case 1:
        // 64-bit
        this.offset += 8;
        break;
      case 2: {
        // length-delimited
        const length = this.readVarint();
        this.offset += Number(length);
        break;
      }
      case 5:
        // 32-bit
        this.offset += 4;
        break;
      default:
        throw new Error(`unknown wire type: ${wireType}`);
    }
  }

  readBytes() {
    const length = Number(this.readVarint());
    const start = this.offset;
    this.offset += length;
    return this.buffer.subarray(start, this.offset);
  }
}

function extractTimestamp(buffer: Buffer) {
  const cursor = new ProtoCursor(buffer);

  // find block header (field 5)
  let headerBuffer: Buffer | null = null;
  for (let tag = cursor.readTag(); tag; tag = cursor.readTag()) {
    if (tag.fieldNumber === 5 && tag.wireType === 2) {
      headerBuffer = cursor.readBytes();
      break;
    }
    cursor.skip(tag.wireType);
  }

  if (!headerBuffer) return null;

  // find timestamp (field 12) inside header
  const headerCursor = new ProtoCursor(headerBuffer);
  let timestampBuffer: Buffer | null = null;
  for (let tag = headerCursor.readTag(); tag; tag = headerCursor.readTag()) {
    if (tag.fieldNumber === 12 && tag.wireType === 2) {
      timestampBuffer = headerCursor.readBytes();
      break;
    }
    headerCursor.skip(tag.wireType);
  }

  if (!timestampBuffer) return null;

  // extract seconds and nanoseconds
  const tsCursor = new ProtoCursor(timestampBuffer);
  let seconds = 0n;
  let nanoseconds = 0n;

  for (let tag = tsCursor.readTag(); tag; tag = tsCursor.readTag()) {
    if (tag.fieldNumber === 1) seconds = tsCursor.readVarint();
    else if (tag.fieldNumber === 2) nanoseconds = tsCursor.readVarint();
    else tsCursor.skip(tag.wireType);
  }

  return seconds * 1_000_000_000n + nanoseconds;
}

/* eslint-disable no-console */
readline
  .createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  .on("line", (line: string) => {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("FIRE INIT")) {
      const parts = trimmedLine.split(/\s+/);
      if (parts.length >= 3) {
        parts[2] = "3.0";
        console.log(parts.join(" "));
      } else console.log(line);
      return;
    }

    if (trimmedLine.startsWith("FIRE BLOCK")) {
      const parts = trimmedLine.split(/\s+/);
      if (parts.length === 7) {
        const [, , num, hash, libNum, parentHash, payloadB64] = parts; // eslint-disable-line unicorn/no-unreadable-array-destructuring, unicorn/prevent-abbreviations
        try {
          const buffer = Buffer.from(payloadB64!, "base64"); // eslint-disable-line @typescript-eslint/no-non-null-assertion
          const ts = extractTimestamp(buffer);
          const timestamp = ts === null ? "0" : ts.toString();
          const patch = Buffer.from([0x08, 0x03]); // 0x08 = field 1, wire 0. 0x03 = value 3.
          const newBuffer = Buffer.concat([buffer, patch]);
          const newPayload = newBuffer.toString("base64");
          console.log(`FIRE BLOCK ${num} ${hash} ${libNum} ${parentHash} ${libNum} ${timestamp} ${newPayload}`);
        } catch (error: unknown) {
          console.error(`error converting block ${num}: ${error instanceof Error ? error.message : "unknown"}`);
          console.log(line);
        }
        return;
      } else {
        console.error(`skipping malformed FIRE BLOCK (len=${parts.length}): ${trimmedLine.slice(0, 50)}...`);
      }
      return;
    }

    console.log(line);
  });
/* eslint-enable no-console */
