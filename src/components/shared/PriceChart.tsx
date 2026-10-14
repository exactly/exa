import React, { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Stop } from "react-native-svg";
import { LineChart } from "react-native-wagmi-charts";

import { impactAsync, ImpactFeedbackStyle, selectionAsync } from "expo-haptics";

import { ChartLine, ChevronRight } from "@tamagui/lucide-icons-2";
import { useTheme, XStack, YStack } from "tamagui";

import { curveStep } from "d3-shape";
import { formatDistanceToNowStrict } from "date-fns";

import Chip from "./Chip";
import Skeleton from "./Skeleton";
import Text from "./Text";
import { date } from "../../i18n";
import { defaultRange, ranges, useHistory } from "../../utils/prices";
import reportError from "../../utils/reportError";

import type { Token } from "@lifi/sdk";

export default function PriceChart({
  token,
  name,
  symbol,
  logo,
}: {
  logo: React.ReactNode;
  name: string;
  symbol: string;
  token: { address: string; chainId: number; priceUSD: string; symbol: string };
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const theme = useTheme();
  const [range, setRange] = useState(() => defaultRange(token));
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState(-1);
  const formats = useMemo(
    () => ({
      day: new Intl.DateTimeFormat(language, { weekday: "short", day: "numeric", month: "short" }),
      time: new Intl.DateTimeFormat(language, { timeStyle: "short" }),
    }),
    [language],
  );
  const { data, isError, isPlaceholderData, refetch } = useHistory(token, range);
  const points = data?.points;
  const first = points?.[0];
  const last = points?.at(-1);
  const point = points?.[selected] ?? last;
  const base = first?.value;
  const change = base !== undefined && point ? delta(base, point.value) : 0;
  const x =
    selected === -1 || !point || !first || !last
      ? undefined
      : ((point.timestamp - first.timestamp) / (last.timestamp - first.timestamp || 1)) * width;
  const value = point?.value ?? Number(token.priceUSD);
  const digits = decimals(value);
  const price = usd(value, language).slice(1);
  return (
    <YStack gap="$s4">
      <YStack gap="$s4">
        <XStack alignItems="center" gap="$s4">
          <YStack flex={1} gap="$s1">
            <Text title3 numberOfLines={1} adjustsFontSizeToFit>
              {name}
            </Text>
            <Text footnote color="$uiNeutralSecondary">
              {symbol}
            </Text>
          </YStack>
          {logo}
        </XStack>
        {point || data === null || isError ? (
          <XStack alignItems="center" aria-label={`$${price}`}>
            <Text aria-hidden callout color="$uiNeutralSecondary">
              $
            </Text>
            <Text aria-hidden largeTitle numberOfLines={1}>
              {price.slice(0, -digits - 1)}
            </Text>
            <Text aria-hidden callout color="$uiNeutralSecondary" alignSelf="flex-start">
              {price.slice(-digits - 1)}
            </Text>
          </XStack>
        ) : (
          <Skeleton width={140} height={47} />
        )}
        {data === null || (isError && !points) ? null : base !== undefined && point && !isPlaceholderData ? (
          <Text subHeadline emphasized color={tint(change)}>
            {`${sign(change)}${usd(Math.abs(point.value - base), language)} (${sign(change)}${percent(Math.abs(change), language)})`}
          </Text>
        ) : (
          <Skeleton width={180} height={21} />
        )}
      </YStack>
      <YStack
        height={height + 16}
        opacity={isPlaceholderData ? 0.5 : 1}
        role="img"
        aria-label={
          first && last
            ? `${usd(last.value, language)}, ${percent(delta(first.value, last.value), language)}, ${t(periods[range])}`
            : undefined
        }
        onLayout={({ nativeEvent }) => {
          setWidth(nativeEvent.layout.width);
        }}
      >
        <YStack height={16}>
          {x !== undefined && point && (
            <Text
              caption2
              color="$uiNeutralSecondary"
              position="absolute"
              width={160}
              left={Math.min(Math.max(x - 80, 0), width - 160)}
              textAlign="center"
              numberOfLines={1}
            >
              {`${formats.day.format(point.timestamp)} - ${formats.time.format(point.timestamp)}`}
            </Text>
          )}
        </YStack>
        {data === null ? (
          <YStack flex={1} alignItems="center" justifyContent="center" gap="$s3">
            <ChartLine size={24} color="$uiNeutralPlaceholder" />
            <Text footnote color="$uiNeutralSecondary">
              {t("Price history unavailable")}
            </Text>
          </YStack>
        ) : isError && !points ? (
          <YStack flex={1} alignItems="center" justifyContent="center" gap="$s3">
            <Text footnote color="$uiNeutralSecondary">
              {t("Price history unavailable")}
            </Text>
            <Chip
              icon={null}
              label={t("Retry")}
              selected={false}
              onPress={() => {
                refetch().catch(reportError);
              }}
            />
          </YStack>
        ) : width > 0 && points && first && last ? (
          <Plot
            points={points}
            width={width}
            color={
              theme[
                last.value > first.value
                  ? "uiSuccessSecondary"
                  : last.value < first.value
                    ? "uiErrorSecondary"
                    : "uiNeutralSecondary"
              ].val
            }
            onSelect={setSelected}
          />
        ) : (
          <Skeleton width="100%" height={height} />
        )}
      </YStack>
      <XStack gap="$s3" justifyContent="center">
        {(Object.keys(ranges) as (keyof typeof ranges)[]).map((key) => (
          <XStack
            key={key}
            padding="$s3"
            borderRadius="$r3"
            backgroundColor={key === range ? "$interactiveBaseBrandSoftDefault" : "transparent"}
            cursor="pointer"
            role="button"
            aria-label={t(key)}
            pressStyle={{ opacity: 0.7 }}
            onPress={() => {
              selectionAsync().catch(reportError);
              setRange(key);
            }}
          >
            <Text footnote color={key === range ? "$interactiveOnBaseBrandSoft" : "$uiNeutralSecondary"}>
              {t(key)}
            </Text>
          </XStack>
        ))}
      </XStack>
      {data && (
        <Text caption2 color="$uiNeutralPlaceholder" textAlign="center">
          {t("Last updated: {{time}}", {
            time: formatDistanceToNowStrict(data.updated, { addSuffix: true, locale: date() }),
          })}
        </Text>
      )}
    </YStack>
  );
}

export function PriceSummary({ token, onPress }: { onPress: () => void; token: Token }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const range = defaultRange(token);
  const { data, isError } = useHistory(token, range, 2);
  const first = data?.points[0];
  const last = data?.points.at(-1);
  return (
    <XStack
      alignItems="center"
      gap="$s4"
      padding="$s4"
      borderWidth={1}
      borderColor="$borderNeutralSoft"
      borderRadius="$r3"
      cursor="pointer"
      role="button"
      aria-label={t("{{symbol}} price", { symbol: token.symbol })}
      pressStyle={{ opacity: 0.7 }}
      onPress={onPress}
    >
      <YStack flex={1} gap="$s2">
        <Text footnote color="$uiNeutralSecondary">
          {t("{{symbol}} price", { symbol: token.symbol })}
        </Text>
        {data === null || (isError && !data) ? (
          <Text headline emphasized>
            {usd(Number(token.priceUSD), language)}
          </Text>
        ) : first && last ? (
          <>
            <Text headline emphasized>
              {usd(last.value, language)}
            </Text>
            <Change from={first.value} to={last.value} label={t(periods[range])} />
          </>
        ) : (
          <Skeleton width={120} height={36} />
        )}
      </YStack>
      <ChevronRight size={16} color="$interactiveOnBaseBrandSoft" />
    </XStack>
  );
}

export function Trend({ chainId, address, symbol }: { address: string; chainId: number; symbol: string }) {
  const {
    i18n: { language },
  } = useTranslation();
  const { data, isPending } = useHistory({ address, chainId, symbol }, "1D", 2);
  if (isPending) return <Skeleton height={12} width={50} />;
  const first = data?.points[0];
  const last = data?.points.at(-1);
  if (!first || !last) return null;
  const change = delta(first.value, last.value);
  return (
    <Text caption textAlign="right" color={tint(change)}>
      {`${sign(change)}${percent(Math.abs(change), language)}`}
    </Text>
  );
}

const Plot = memo(function Plot({
  points,
  width,
  color,
  onSelect,
}: {
  color: string;
  onSelect: (index: number) => void;
  points: { timestamp: number; value: number }[];
  width: number;
}) {
  const theme = useTheme();
  return (
    <LineChart.Provider
      data={points}
      xDomain={[points[0]?.timestamp ?? 0, points.at(-1)?.timestamp ?? 0]}
      onCurrentIndexChange={(index) => {
        onSelect(index);
        if (index !== -1) selectionAsync().catch(reportError);
      }}
    >
      <LineChart width={width} height={height} yGutter={24} xAxisLabelHeight={0} shape={curveStep}>
        <LineChart.Path color={color} width={2}>
          <LineChart.Gradient>
            <Stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <Stop offset="50%" stopColor={color} stopOpacity={0.1} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </LineChart.Gradient>
          <LineChart.HorizontalLine
            at={{ value: points[0]?.value ?? 0 }}
            color={theme.uiNeutralSecondary.val}
            lineProps={{ strokeWidth: 0.5, strokeDasharray: "6 4" }}
          />
        </LineChart.Path>
        <LineChart.CursorLine
          color={theme.uiNeutralPlaceholder.val}
          showLabel={false}
          lineProps={{ strokeWidth: 1, strokeDasharray: undefined }}
        />
        <LineChart.CursorCrosshair
          snapToPoint
          color={color}
          size={12}
          outerSize={40}
          onActivated={() => {
            impactAsync(ImpactFeedbackStyle.Light).catch(reportError);
          }}
          onEnded={() => {
            impactAsync(ImpactFeedbackStyle.Light).catch(reportError);
          }}
        />
      </LineChart>
    </LineChart.Provider>
  );
});

function Change({ from, to, label }: { from: number; label: string; to: number }) {
  const {
    i18n: { language },
  } = useTranslation();
  const change = delta(from, to);
  return (
    <XStack gap="$s2" alignItems="center">
      <Text caption emphasized color={tint(change)}>
        {`${sign(change)}${usd(Math.abs(to - from), language)} (${sign(change)}${percent(Math.abs(change), language)})`}
      </Text>
      <Text caption color="$uiNeutralSecondary" numberOfLines={1} flexShrink={1}>
        {label}
      </Text>
    </XStack>
  );
}

function delta(from: number, to: number) {
  return to / from - 1;
}

function sign(change: number) {
  if (change > 0) return "+";
  if (change < 0) return "-";
  return "";
}

function tint(change: number) {
  if (change > 0) return "$uiSuccessSecondary";
  if (change < 0) return "$uiErrorSecondary";
  return "$uiNeutralSecondary";
}

function usd(value: number, language: string) {
  const digits = decimals(value);
  return `$${value.toLocaleString(language, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function decimals(value: number) {
  return value >= 1e-6 && value < 0.01 ? 1 - Math.floor(Math.log10(value)) : 2;
}

function percent(value: number, language: string) {
  return value.toLocaleString(language, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const height = 173;

const periods = { "1D": "Past day", "1W": "Past week", "1M": "Past month" } as const;
