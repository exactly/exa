import React from "react";
import { useTranslation } from "react-i18next";

import { Separator, Square, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";

import TransactionDetails from "./TransactionDetails";
import { ArrowDownToLine } from "../../../generated/icons/ArrowDownToLine";
import { ArrowLeftRight } from "../../../generated/icons/ArrowLeftRight";
import { ArrowUpRight } from "../../../generated/icons/ArrowUpRight";
import { HandCoins } from "../../../generated/icons/HandCoins";
import { RefreshCw } from "../../../generated/icons/RefreshCw";
import { TriangleAlert } from "../../../generated/icons/TriangleAlert";
import { lifiChainsOptions } from "../../../utils/lifi";
import AssetLogo from "../../shared/AssetLogo";
import ChainLogo from "../../shared/ChainLogo";
import Text from "../../shared/Text";

import type { ActivityItem } from "../../../utils/queryClient";
import type { TFunction } from "i18next";

type Item = Extract<ActivityItem, { type: "bridge" | "liquidation" | "loan" | "rollover" | "swap" }>;

export default function OnchainActivity({ item }: { item: Item }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { amount, usdAmount, currency } = item;
  return (
    <>
      <YStack gap="s7" paddingBottom="s9">
        <XStack justifyContent="center" alignItems="center">
          <Square borderRadius="r4" backgroundColor="backgroundStrong" size="s10">
            {icon(item)}
          </Square>
        </XStack>
        <YStack gap="s4_5" justifyContent="center" alignItems="center">
          {item.type === "bridge" && item.destinationChainId !== chain.id ? (
            <Text secondary body>
              {t("Sent to")}
              <Text emphasized primary body>
                &nbsp;
                {shortenHex(item.receiver)}
              </Text>
            </Text>
          ) : (
            <Text primary body emphasized textAlign="center">
              {title(item, t)}
            </Text>
          )}
          {usdAmount !== undefined && (
            <Text title primary color={item.type === "loan" ? "uiSuccessSecondary" : "uiNeutralPrimary"}>
              {`$${usdAmount.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </Text>
          )}
          <XStack gap="s3" alignItems="center">
            <Text emphasized subHeadline color="uiNeutralSecondary">
              {amount.toLocaleString(language, { maximumFractionDigits: 8, minimumFractionDigits: 0 })}
              &nbsp;
              {currency}
            </Text>
            <AssetLogo symbol={currency} width={16} height={16} />
          </XStack>
        </YStack>
      </YStack>
      <YStack flex={1} gap="s7">
        <Details item={item} />
        <TransactionDetails item={item} />
      </YStack>
    </>
  );
}

function Details({ item }: { item: Item }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const number = (value: number) => value.toLocaleString(language, { maximumFractionDigits: 8 });
  const percent = (value: number) =>
    value.toLocaleString(language, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let rows: [string, React.ReactNode][];
  switch (item.type) {
    case "loan":
      rows = [
        [t("Fee"), `${number(item.fee)} ${item.currency}`],
        [t("Fixed rate APR"), percent(item.rate)],
        [t("Due date"), date(item.maturity)],
      ];
      break;
    case "rollover":
      rows = [
        [t("Previous due date"), date(item.maturity)],
        [t("New due date"), date(item.borrow.maturity)],
        [t("Fee"), `${number(item.borrow.fee)} ${item.currency}`],
        [t("Fixed rate APR"), percent(item.borrow.rate)],
      ];
      break;
    case "swap":
      rows = [
        [t("You paid"), `${number(item.from.amount)} ${item.from.currency}`],
        [t("You received"), `${number(item.amount)} ${item.currency}`],
      ];
      break;
    case "liquidation":
      rows = [
        [t("Debt repaid"), `${number(item.amount)} ${item.currency}`],
        [t("Collateral seized"), `${number(item.seize.amount)} ${item.seize.currency}`],
      ];
      break;
    case "bridge":
      rows =
        item.destinationChainId === chain.id
          ? [[t("Source network"), <Network key="network" chainId={item.sourceChainId} />]]
          : [[t("Destination network"), <Network key="network" chainId={item.destinationChainId} />]];
      break;
  }
  return (
    <YStack gap="s4">
      <YStack gap="s4">
        <Text emphasized headline>
          {t("Details")}
        </Text>
        <Separator height={1} borderColor="borderNeutralSoft" />
      </YStack>
      <YStack gap="s3_5">
        {rows.map(([label, value]) => (
          <XStack key={label} justifyContent="space-between" alignItems="center">
            <Text emphasized footnote color="uiNeutralSecondary">
              {label}
            </Text>
            {typeof value === "string" ? (
              <Text callout color="uiNeutralPrimary">
                {value}
              </Text>
            ) : (
              value
            )}
          </XStack>
        ))}
      </YStack>
    </YStack>
  );
}

function date(timestamp: number) {
  return format(timestamp * 1000, "yyyy-MM-dd");
}

function Network({ chainId }: { chainId: number }) {
  const { data: name } = useQuery({
    ...lifiChainsOptions,
    select: (chains) => chains.find(({ id }) => id === chainId)?.name,
  });
  return (
    <XStack gap="s3" alignItems="center">
      <Text callout color="uiNeutralPrimary">
        {name ?? chainId}
      </Text>
      <ChainLogo chainId={chainId} size={20} />
    </XStack>
  );
}

function icon(item: Item) {
  switch (item.type) {
    case "loan":
      return <HandCoins size={48} color="interactiveOnBaseSuccessSoft" strokeWidth={2} />;
    case "rollover":
      return <RefreshCw size={48} color="uiNeutralPrimary" strokeWidth={2} />;
    case "swap":
      return <ArrowLeftRight size={48} color="uiNeutralPrimary" strokeWidth={2} />;
    case "liquidation":
      return <TriangleAlert size={48} color="interactiveOnBaseErrorSoft" strokeWidth={2} />;
    case "bridge":
      if (item.destinationChainId === chain.id) {
        return <ArrowDownToLine size={48} color="interactiveOnBaseSuccessSoft" strokeWidth={2} />;
      }
      return <ArrowUpRight size={48} color="interactiveOnBaseErrorSoft" strokeWidth={2} />;
  }
}

function title(item: Item, t: TFunction) {
  switch (item.type) {
    case "loan":
      return t("Loan");
    case "rollover":
      return t("Debt rollover");
    case "swap":
      return t("Swapped {{from}} for {{to}}", { from: item.from.currency, to: item.currency });
    case "liquidation":
      return t("Liquidation");
    case "bridge":
      return item.destinationChainId === chain.id ? t("Received from another network") : t("Sent to another network");
  }
}
