import React, { useId, useMemo } from "react";
import type { SvgProps } from "react-native-svg";
import { SvgCss } from "react-native-svg/css";

import { useTheme } from "tamagui";

import { isBase } from "../../../tamagui.config";

const fallbackHue = 222;
const tealMin = 140;
const tealMax = 200;

export default function ThemedSvg({ xml, ...properties }: SvgProps & { xml: unknown }) {
  const theme = useTheme();
  const elementId = useId().replaceAll(":", "");
  const brandHue = hueOf(theme.iconBrandDefault.val);
  const themed = useMemo(() => inject(xml as string, elementId, brandHue), [xml, elementId, brandHue]);
  return <SvgCss xml={themed} override={properties} />;
}

function inject(xml: string, prefix: string, brandHue: number) {
  const scoped = xml
    .replaceAll(/\bid="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
    .replaceAll(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`)
    .replaceAll(/(\bhref|xlink:href)="#([^"]+)"/g, (_, attribute, id) => `${attribute}="#${prefix}${id}"`);
  const hexes = new Set<string>();
  for (const [, hex] of scoped.matchAll(/var\(--s([0-9a-f]{6}),/g)) if (hex) hexes.add(hex);
  if (hexes.size === 0) return scoped;
  const variables = [...hexes].map((hex) => `--s${hex}:${isBase ? recolor(hex, brandHue) : `#${hex}`}`).join(";");
  return scoped.replace(/<svg\b[^>]*>/, (svg) => `${svg}<style>:root{${variables}}</style>`);
}

function recolor(hex: string, brandHue: number) {
  const [h, s, l] = toHsl(hex);
  if (s < 0.15 || l < 0.06 || l > 0.95 || h < tealMin || h > tealMax) return `#${hex}`;
  return hsl(brandHue, s, l);
}

function hueOf(color: unknown) {
  const hex = typeof color === "string" ? color.replace("#", "") : "";
  return /^[\da-f]{6}$/i.test(hex) ? toHsl(hex)[0] : fallbackHue;
}

function toHsl(hex: string): [number, number, number] {
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = d === 0 ? 0 : 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return [h, s, l];
}

function hsl(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const channel = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
