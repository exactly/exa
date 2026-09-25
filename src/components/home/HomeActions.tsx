import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowDownToLine, ArrowUpRight, HandCoins, Repeat } from "@tamagui/lucide-icons-2";
import { XStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { useBytecode, useReadContract } from "wagmi";

import accountInit from "@exactly/common/accountInit";
import chain, { exaPluginAddress } from "@exactly/common/generated/chain";
import {
  upgradeableModularAccountAbi,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "@exactly/common/generated/hooks";

import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import Button from "../shared/StyledButton";

import type { Credential } from "@exactly/common/validation";

export default function HomeActions() {
  const router = useRouter();
  const { address: account } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: bytecode } = useBytecode({ address: account, chainId: chain.id, query: { enabled: !!account } });
  const { t } = useTranslation();
  const actions = useMemo(
    () => [
      { key: "deposit", title: t("Deposit"), Icon: ArrowDownToLine },
      { key: "send", title: t("Send", { context: "home" }), Icon: ArrowUpRight },
      ...(bytecode
        ? [
            { key: "swap" as const, title: t("Swap", { context: "home" }), Icon: Repeat },
            { key: "borrow" as const, title: t("Borrow", { context: "home" }), Icon: HandCoins },
          ]
        : []),
    ],
    [bytecode, t],
  );
  const [column, setColumn] = useState(0);
  const [labels, setLabels] = useState<Record<string, number>>({});
  const widest = Math.max(0, ...actions.map(({ title }) => labels[title] ?? 0));
  const scale = column && widest ? Math.min(1, (column * 0.94) / widest) : 1;

  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: account,
    chainId: chain.id,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: { enabled: !!account && !!credential },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  const { refetch: fetchProposals, isPending } = useReadContract({
    chainId: chain.id,
    functionName: "proposals",
    abi: [
      ...upgradeableModularAccountAbi,
      {
        type: "function",
        inputs: [{ name: "account", internalType: "address", type: "address" }],
        name: "proposals",
        outputs: [
          { name: "amount", internalType: "uint256", type: "uint256" },
          { name: "market", internalType: "contract IMarket", type: "address" },
          { name: "receiver", internalType: "address", type: "address" },
          { name: "timestamp", internalType: "uint256", type: "uint256" },
        ],
        stateMutability: "view",
      },
    ],
    address: installedPlugins?.[0],
    args: account ? [account] : undefined,
    query: { enabled: !!account && !!installedPlugins?.[0] && !isLatestPlugin },
  });

  const handleSend = async () => {
    if (isLatestPlugin) {
      router.push("/send-funds");
    } else {
      if (isPending) return;
      const { data: proposals } = await fetchProposals();
      if (proposals && proposals[0] > 0n) {
        router.push("/pending-proposals");
      } else {
        router.push("/send-funds");
      }
    }
  };
  return (
    <XStack gap="$s3" justifyContent="space-between" width="100%">
      {actions
        .filter(({ title }) => !labels[title])
        .map(({ title }) => (
          <Button.Label
            key={title}
            aria-hidden
            position="absolute"
            opacity={0}
            pointerEvents="none"
            fontSize={probe}
            onLayout={({ nativeEvent }) => {
              if (!nativeEvent.layout.width) return;
              setLabels((current) => ({ ...current, [title]: nativeEvent.layout.width }));
            }}
          >
            {title}
          </Button.Label>
        ))}
      {actions.map(({ key, title, Icon }) => {
        const disabled = key !== "deposit" && !bytecode;
        const handlePress = disabled
          ? undefined
          : () => {
              switch (key) {
                case "deposit":
                  router.push("/add-funds");
                  break;
                case "send":
                  handleSend().catch(reportError);
                  break;
                case "swap":
                  router.push("/swaps");
                  break;
                case "borrow":
                  router.push("/loan");
                  break;
              }
            };
        return (
          <Button.Column
            key={key}
            primary={key === "deposit"}
            secondary={key !== "deposit"}
            disabled={disabled}
            loading={key === "send" && !isLatestPlugin && isPending && !!bytecode}
            flex={1}
            aria-label={title}
            role="button"
            aria-disabled={disabled}
            onPress={handlePress}
            onLayout={({ nativeEvent }) => {
              setColumn(nativeEvent.layout.width);
            }}
          >
            <Button width="100%" padding="$s3_5" justifyContent="center" minHeight="auto">
              <Button.Icon>
                <Icon />
              </Button.Icon>
            </Button>
            <Button.Label fontSize={probe * scale}>{title}</Button.Label>
          </Button.Column>
        );
      })}
    </XStack>
  );
}

const probe = 14;
