import { mkdirSync, writeFileSync } from "node:fs";
import { create } from "qrcode";

const width = 640;
const height = 480;

mkdirSync("generated", { recursive: true });
for (const [flow, code] of Object.entries({
  pix: "00020126330014br.gov.bcb.pix0111529982247255204000053039865406270.005802BR5911Test <&> Co6009SAO PAULO61080131010062070503exa6304BF26",
  transfer: "ethereum:0x000000000000000000000000000000000000bEEF@31337",
})) {
  const { modules } = create(code);
  const scale = Math.floor(height / (modules.size + 8));
  const left = (width - modules.size * scale) >> 1;
  const top = (height - modules.size * scale) >> 1;
  const pixels = Buffer.alloc(width * height, 255);
  for (let y = 0; y < modules.size * scale; y++) {
    for (let x = 0; x < modules.size * scale; x++) {
      if (modules.get(Math.floor(y / scale), Math.floor(x / scale))) pixels[(top + y) * width + left + x] = 0;
    }
  }
  writeFileSync(
    `generated/${flow}.y4m`,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${width} H${height} F1:1 Ip A1:1 C420jpeg\nFRAME\n`),
      pixels,
      Buffer.alloc((width * height) / 2, 128),
    ]),
  );
}
