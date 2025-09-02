import React from "react";
import { Svg, Rect, ClipPath, Defs, Circle, G } from "react-native-svg";

interface BlockieProperties {
  seed: string;
  size?: number;
}

export default function Blockie({ seed, size = 96 }: BlockieProperties) {
  const cells = 5;
  const seedNumber = stringToSeed(seed);
  const rand = mulberry32(seedNumber);

  const bg = hslToHex(rand() * 360, 0.4 + rand() * 0.2, 0.9);
  const fg = hslToHex(rand() * 360, 0.6, 0.45);
  const spot = hslToHex(rand() * 360, 0.7, 0.55);

  const pixels: { x: number; y: number; fill: string }[] = [];
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < Math.ceil(cells / 2); x++) {
      const r = rand();
      const fill = r < 0.5 ? null : r < 0.75 ? fg : spot;
      if (!fill) continue;
      pixels.push({ x, y, fill });
      const mx = cells - 1 - x;
      if (mx !== x) pixels.push({ x: mx, y, fill });
    }
  }

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${cells} ${cells}`}>
      <Defs>
        <ClipPath id="clip">
          <Circle cx={cells / 2} cy={cells / 2} r={cells / 2} />
        </ClipPath>
      </Defs>
      <G clipPath="url(#clip)">
        <Rect x={0} y={0} width={cells} height={cells} fill={bg} />
        {pixels.map((p, index) => (
          <Rect key={index} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
        ))}
      </G>
    </Svg>
  );
}

function stringToSeed(string_: string) {
  let h = 2_166_136_261 >>> 0;
  for (let index = 0; index < string_.length; index++) {
    h ^= string_.codePointAt(index)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

function mulberry32(a: number) {
  return function () {
    // eslint-disable-next-line no-multi-assign
    let t = (a += 0x6d_2b_79_f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hslToHex(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c);
  };
  const r = f(0),
    g = f(8),
    b = f(4);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function toHex(n: number) {
  return n.toString(16).padStart(2, "0");
}
