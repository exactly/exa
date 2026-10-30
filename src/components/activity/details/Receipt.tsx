import React, { useId } from "react";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { PixelRatio, Platform } from "react-native";
import QRCode from "react-native-qrcode-styled";
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect, Text } from "react-native-svg";
import { SvgCss } from "react-native-svg/css";

import { Asset } from "expo-asset";
import type { FontSource } from "expo-font";

import { useTheme } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";

import SplineSansRegular from "../../../assets/fonts/SplineSans-Regular.otf";
import SplineSansSemiBold from "../../../assets/fonts/SplineSans-SemiBold.otf";
import SplineSansMonoMedium from "../../../assets/fonts/SplineSansMono-Medium.otf";
import ExaLogo from "../../../assets/images/exa-logo-light.svg";
import { date } from "../../../i18n";
import { getTokenLogoURI } from "../../../utils/assetLogos";
import { lifiChainsOptions, lifiTokensOptions } from "../../../utils/lifi";

import type { ActivityItem } from "../../../utils/queryClient";

export default function Receipt({
  ref,
  account,
  item: { amount, currency, receiver, timestamp, transactionHash, usdAmount },
}: {
  account?: string;
  item: Extract<ActivityItem, { type: "sent" }>;
  ref: Ref<Svg>;
}) {
  const theme = useTheme();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { data: tokens = [] } = useQuery(lifiTokensOptions);
  const { data: network } = useQuery({
    ...lifiChainsOptions,
    select: (chains) => chains.find(({ id }) => id === chain.id)?.logoURI,
  });
  const { data: fonts } = useQuery({
    queryKey: ["receipt", "fonts"],
    enabled: Platform.OS === "web",
    staleTime: Infinity,
    queryFn: () =>
      Promise.all(
        Object.entries(faces).map(async ([family, source]) => {
          const blob = await fetch(Asset.fromModule(source as number).uri).then((response) => response.blob());
          const url = await new Promise<unknown>((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => {
              resolve(reader.result);
            });
            reader.addEventListener("error", reject);
            reader.readAsDataURL(blob);
          });
          return `@font-face{font-family:"${family}";src:url(${String(url)})}`;
        }),
      ).then((rules) => rules.join("")),
  });
  const primary = theme.uiNeutralPrimary.val;
  const secondary = theme.uiNeutralSecondary.val;
  const border = theme.borderNeutralSoft.val;
  const success = theme.uiSuccessSecondary.val;
  const explorer = chain.blockExplorers?.default.url;
  const rows = [
    { label: t("From"), value: account && shortenHex(account, 6, 6), mono: true },
    { label: t("To"), value: shortenHex(receiver, 6, 6), mono: true },
    { label: t("Asset"), value: currency, logo: getTokenLogoURI(tokens, currency, chain.id) },
    { label: t("Network"), value: chain.name, logo: network },
    { label: t("Network fee"), value: t("FREE"), color: success },
  ];
  const columns = [
    ...(explorer
      ? [
          {
            title: t("Verify transfer"),
            caption: t("on the explorer"),
            qr: (
              <QRCode
                data={`${explorer}/tx/${transactionHash}`}
                size={96}
                color={primary}
                pieceBorderRadius={1}
                isPiecesGlued
              />
            ),
          },
        ]
      : []),
    {
      title: t("Download Exa"),
      caption: "App Store · Google Play",
      qr: (
        <>
          <Rect width={96} height={96} rx={12} fill={theme.backgroundBrand.val} />
          <Rect transform={[{ translateX: 8 }, { translateY: 8 }]} width={80} height={80} rx={4} fill="white" />
          <G transform={[{ translateX: 13 }, { translateY: 13 }]}>
            <QRCode data={download} size={70} color={primary} pieceBorderRadius={1} isPiecesGlued />
          </G>
        </>
      ),
    },
  ];
  return (
    <Svg
      ref={ref}
      width={size.width / PixelRatio.get()}
      height={size.height / PixelRatio.get()}
      viewBox={`0 0 ${width} ${height}`}
    >
      {fonts && <style>{fonts}</style>}
      <Rect width={width} height={height} fill={theme.backgroundStrong.val} />
      <Rect width={width} height={168} fill={theme.backgroundBrand.val} />
      <G transform={[{ translateX: 24 }, { translateY: 26 }]}>
        <ExaLogo width={57} height={18} />
      </G>
      <Rect
        transform={[{ translateX: 16 }, { translateY: 68 }]}
        width={width - 32}
        height={height - 84}
        rx={20}
        fill={theme.backgroundSoft.val}
      />
      <Circle cx={width / 2} cy={116} r={24} fill={theme.interactiveBaseSuccessSoftDefault.val} />
      <G transform={[{ translateX: width / 2 - 12 }, { translateY: 104 }]}>
        {["m18 9-6-6-6 6", "M12 3v14", "M5 21h14"].map((d) => (
          <Path
            key={d}
            d={d}
            stroke={success}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
      </G>
      <Text
        transform={[{ translateX: width / 2 }, { translateY: 168 }]}
        textAnchor="middle"
        fontFamily="SplineSans-SemiBold"
        fontSize={16}
        letterSpacing={-0.032}
        fill={secondary}
      >
        {t("Transfer sent")}
      </Text>
      <Text
        transform={[{ translateX: width / 2 }, { translateY: 211 }]}
        textAnchor="middle"
        fontFamily="SplineSans-SemiBold"
        fontSize={36}
        letterSpacing={-0.072}
        fill={primary}
      >
        {`$${usdAmount.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
      </Text>
      <Text
        transform={[{ translateX: width / 2 }, { translateY: 236 }]}
        textAnchor="middle"
        fontFamily="SplineSans-Regular"
        fontSize={15}
        letterSpacing={-0.03}
        fill={secondary}
      >
        {`${amount.toLocaleString(language, { maximumFractionDigits: 8 })} ${currency}`}
      </Text>
      <Text
        transform={[{ translateX: width / 2 }, { translateY: 267 }]}
        textAnchor="middle"
        fontFamily="SplineSans-Regular"
        fontSize={14}
        letterSpacing={-0.028}
        fill={secondary}
      >
        {format(timestamp, "PPP, p", { locale: date() })}
      </Text>
      <Rect
        transform={[{ translateX: width / 2 - 71 }, { translateY: 280 }]}
        width={142}
        height={23}
        rx={11.5}
        fill={theme.backgroundMild.val}
      />
      <Text
        transform={[{ translateX: width / 2 - 61 }, { translateY: 295 }]}
        fontFamily="SplineSans-SemiBold"
        fontSize={11.5}
        fill={secondary}
      >
        {t("ID")}
      </Text>
      <Text
        transform={[{ translateX: width / 2 + 61 }, { translateY: 295 }]}
        textAnchor="end"
        fontFamily="SplineSansMono-Medium"
        fontSize={11.5}
        fill={primary}
      >
        {shortenHex(transactionHash, 6, 6)}
      </Text>
      <Line x1={36} x2={width - 36} y1={326} y2={326} stroke={border} strokeDasharray="4 4" />
      <Circle cx={16} cy={326} r={10} fill={theme.backgroundStrong.val} />
      <Circle cx={width - 16} cy={326} r={10} fill={theme.backgroundStrong.val} />
      <Rect
        transform={[{ translateX: 36 }, { translateY: 351 }]}
        width={width - 72}
        height={rows.length * 40}
        rx={12}
        fill={theme.backgroundMild.val}
      />
      {rows.map(({ label, value, mono, logo, color }, index) => (
        <G key={label} transform={[{ translateY: 351 + index * 40 }]}>
          {index > 0 && <Line x1={52} x2={width - 52} stroke={border} />}
          <Text
            transform={[{ translateX: 52 }, { translateY: 25.5 }]}
            fontFamily="SplineSans-SemiBold"
            fontSize={13}
            letterSpacing={-0.026}
            fill={secondary}
          >
            {label}
          </Text>
          <Text
            transform={[{ translateX: width - (logo ? 74 : 52) }, { translateY: 25 }]}
            textAnchor="end"
            fontFamily={mono ? "SplineSansMono-Medium" : "SplineSans-Regular"}
            fontSize={mono ? 12 : 14}
            letterSpacing={mono ? 0 : -0.028}
            fill={color ?? primary}
          >
            {value}
          </Text>
          {logo && <Logo uri={logo} x={width - 68} y={12} />}
        </G>
      ))}
      <Line x1={36} x2={width - 36} y1={571} y2={571} stroke={border} />
      {columns.length > 1 && <Line x1={width / 2} x2={width / 2} y1={596} y2={722} stroke={border} />}
      {columns.map(({ title, caption, qr }, index) => {
        const center = columns.length > 1 ? (index ? 265.3 : 109.7) : width / 2;
        return (
          <G key={title}>
            <G transform={[{ translateX: center - 48 }, { translateY: 592 }]}>{qr}</G>
            <Text
              transform={[{ translateX: center }, { translateY: 709 }]}
              textAnchor="middle"
              fontFamily="SplineSans-SemiBold"
              fontSize={13}
              letterSpacing={-0.026}
              fill={primary}
            >
              {title}
            </Text>
            <Text
              transform={[{ translateX: center }, { translateY: 723 }]}
              textAnchor="middle"
              fontFamily="SplineSans-Regular"
              fontSize={11.5}
              fill={secondary}
            >
              {caption}
            </Text>
          </G>
        );
      })}
    </Svg>
  );
}

function Logo({ uri, x, y }: { uri: string; x: number; y: number }) {
  const { data: xml } = useQuery({
    queryKey: ["receipt", "logo", uri],
    staleTime: Infinity,
    // web toDataURL rewrites every " to ', so a ' left in the serialized xml attribute breaks the image
    queryFn: () =>
      fetch(uri)
        .then((response) => response.text())
        .then((text) => text.replaceAll("'", '"')),
  });
  const id = useId().replaceAll(/\W/g, "");
  if (!xml) return null;
  return (
    <G transform={[{ translateX: x }, { translateY: y }]}>
      <Defs>
        <ClipPath id={id}>
          <Circle cx={8} cy={8} r={8} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${id})`}>
        <SvgCss xml={xml} width={16} height={16} />
      </G>
    </G>
  );
}

const width = 375;
const height = 765;
export const size = { width: width * 2.4, height: height * 2.4 };
const download = "https://lnkz.app/llgt";
const faces = {
  "SplineSans-Regular": SplineSansRegular as FontSource,
  "SplineSans-SemiBold": SplineSansSemiBold as FontSource,
  "SplineSansMono-Medium": SplineSansMonoMedium as FontSource,
};
