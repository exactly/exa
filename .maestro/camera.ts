import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { create } from "qrcode";

const width = 1280;
const height = 720;

let seed = 1;
const noise = Uint8Array.from(
  { length: width * height },
  () => (seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0) >>> 24,
);

mkdirSync("generated", { recursive: true });
for (const [flow, pixels] of Object.entries({
  ach: noise,
  credit: noise,
  external: noise,
  onboarding: noise,
  pix: qr(
    "00020126330014br.gov.bcb.pix0111529982247255204000053039865406270.005802BR5911Test <&> Co6009SAO PAULO61080131010062070503exa6304BF26",
  ),
  transfer: qr("ethereum:0x000000000000000000000000000000000000bEEF@31337"),
})) {
  writeFileSync(
    `generated/${flow}.y4m`,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\nFRAME\n`),
      pixels,
      Buffer.alloc((width * height) / 2, 128),
    ]),
  );
}
writeFileSync(
  "generated/passport.png",
  Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"), // cspell:ignore idat iend ihdr
    chunk("IHDR", Buffer.from([...uint32(width), ...uint32(height), 8, 0, 0, 0, 0])),
    chunk(
      "IDAT",
      deflateSync(
        Buffer.concat(
          Array.from({ length: height }, (_, y) => [Buffer.of(0), noise.subarray(y * width, (y + 1) * width)]).flat(),
        ),
      ),
    ),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);

function qr(code: string) {
  const { modules } = create(code);
  const scale = Math.floor(height / (modules.size + 8));
  const left = (width - modules.size * scale) >> 1;
  const top = (height - modules.size * scale) >> 1;
  return noise.map((value, index) => {
    const x = (index % width) - left;
    const y = Math.floor(index / width) - top;
    const dark =
      x >= 0 &&
      y >= 0 &&
      x < modules.size * scale &&
      y < modules.size * scale &&
      modules.get(Math.floor(y / scale), Math.floor(x / scale));
    return dark ? value & 0x3f : value | 0xc0;
  });
}

function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]);
  return Buffer.concat([uint32(data.length), body, uint32(crc32(body))]);
}

function uint32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}
