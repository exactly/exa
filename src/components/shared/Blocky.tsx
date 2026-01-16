import React, { useMemo } from "react";
import SVG, { Rect } from "react-native-svg";

export default function Blocky({
  seed,
  color,
  bgcolor,
  spotColor,
  size = 8,
  scale = 4,
}: {
  bgcolor?: string;
  color?: string;
  scale?: number;
  seed: string;
  size?: number;
  spotColor?: string;
}) {
  const resolvedSize = normalizeInteger(size, 8);
  const resolvedScale = normalizeInteger(scale, 4);
  const elements = useMemo(() => {
    return renderIcon({ seed, color, bgcolor, spotColor, size: resolvedSize, scale: resolvedScale });
  }, [seed, color, bgcolor, spotColor, resolvedSize, resolvedScale]);
  return (
    <SVG height={resolvedSize * resolvedScale} width={resolvedSize * resolvedScale}>
      {elements}
    </SVG>
  );
}

function renderIcon(options: {
  bgcolor?: string;
  color?: string;
  scale: number;
  seed: string;
  size: number;
  spotColor?: string;
}) {
  const { size, scale, color, bgcolor, spotColor, rand } = buildOptions(options);
  const imageData = createImageData(size, rand);
  const pixels: React.ReactElement[] = [];

  for (const [index, item] of imageData.entries()) {
    if (!item) continue;
    const row = Math.floor(index / size);
    const column = index % size;
    const fill = item === 1 ? color : spotColor;
    pixels.push(
      <Rect
        key={`cell-${index}`}
        transform={[{ translateX: column * scale }, { translateY: row * scale }]}
        width={scale}
        height={scale}
        fill={fill}
      />,
    );
  }
  return [<Rect key="background" width={size * scale} height={size * scale} fill={bgcolor} />, ...pixels];
}

function buildOptions(options: {
  bgcolor?: string;
  color?: string;
  scale?: number;
  seed?: string;
  size?: number;
  spotColor?: string;
}): {
  bgcolor: string;
  color: string;
  rand: () => number;
  scale: number;
  seed: string;
  size: number;
  spotColor: string;
} {
  const seed = (options.seed ?? Math.floor(Math.random() * 10 ** 16).toString(16)).toLowerCase();
  const rand = createRng(seed);
  const size = normalizeInteger(options.size, 8);
  const scale = normalizeInteger(options.scale, 4);

  return {
    seed,
    size,
    scale,
    color: options.color ?? createColor(rand),
    bgcolor: options.bgcolor ?? createColor(rand),
    spotColor: options.spotColor ?? createColor(rand),
    rand,
  };
}

function createImageData(size: number, rand: () => number) {
  const width = size;
  const height = size;
  const dataWidth = Math.ceil(width / 2);
  const mirrorWidth = width - dataWidth;
  const data: number[] = [];

  for (let y = 0; y < height; y++) {
    let row: number[] = [];
    for (let x = 0; x < dataWidth; x++) {
      row[x] = Math.floor(rand() * 2.3);
    }
    const mirroredRow = row.slice(0, mirrorWidth);
    mirroredRow.reverse();
    row = [...row, ...mirroredRow];
    for (const element of row) {
      data.push(element);
    }
  }

  return data;
}

function normalizeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return floored > 0 ? floored : fallback;
}

function createRng(seed: string) {
  const randomSeed: [number, number, number, number] = [0, 0, 0, 0];

  for (let index = 0; index < seed.length; index++) {
    const seedIndex = (index % 4) as 0 | 1 | 2 | 3;
    randomSeed[seedIndex] = (randomSeed[seedIndex] << 5) - randomSeed[seedIndex] + seed.charCodeAt(index); // eslint-disable-line unicorn/prefer-code-point
  }

  return function rand() {
    const t = randomSeed[0] ^ (randomSeed[0] << 11);
    randomSeed[0] = randomSeed[1];
    randomSeed[1] = randomSeed[2];
    randomSeed[2] = randomSeed[3];
    randomSeed[3] = randomSeed[3] ^ (randomSeed[3] >> 19) ^ t ^ (t >> 8);
    return (randomSeed[3] >>> 0) / ((1 << 31) >>> 0);
  };
}

function createColor(rand: () => number) {
  const hue = Math.floor(rand() * 360);
  const saturation = `${rand() * 60 + 40}%`;
  const lightness = `${(rand() + rand() + rand() + rand()) * 25}%`;
  return `hsl(${hue},${saturation},${lightness})`;
}
