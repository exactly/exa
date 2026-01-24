import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowDownToLine, ArrowUpRight } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { zeroAddress } from "viem";
import { useBytecode, useChainId, useReadContract } from "wagmi";

import {
  exaPluginAddress,
  upgradeableModularAccountAbi,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "@exactly/common/generated/hooks";

import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import Button from "../shared/StyledButton";

import type { AuthMethod } from "../../utils/queryClient";

export default function HomeActions() {
  const router = useRouter();
  const chainId = useChainId();
  const { address: account } = useAccount();
  const { data: method } = useQuery<AuthMethod>({ queryKey: ["method"] });
  const { data: bytecode } = useBytecode({ address: account ?? zeroAddress, query: { enabled: !!account } });
  const { t } = useTranslation();
  const actions = useMemo(
    () => [
      { key: "deposit", title: t("Add funds"), Icon: ArrowDownToLine },
      { key: "send", title: t("Send"), Icon: ArrowUpRight },
    ],
    [t],
  );

  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: account ?? zeroAddress,
    query: { enabled: !!account && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress[chainId as keyof typeof exaPluginAddress];
  const { refetch: fetchProposals, isPending } = useReadContract({
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
    args: [account ?? zeroAddress],
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
    <XStack gap="$s4" justifyContent="space-between" width="100%">
      {actions.map(({ key, title, Icon }) => {
        return (
          <YStack key={key} alignItems="center" flex={1} gap="$s3_5" flexBasis={1 / 2}>
            <Button
              primary={key === "deposit"}
              secondary={key !== "deposit"}
              disabled={key !== "deposit" && !bytecode}
              loading={key === "send" && !isLatestPlugin && isPending && !!bytecode}
              onPress={() => {
                switch (key) {
                  case "deposit":
                    switch (method) {
                      case "siwe":
                        router.push("/add-funds");
                        break;
                      default:
                        router.push("/add-funds/add-crypto");
                        break;
                    }
                    break;
                  case "send":
                    handleSend().catch(reportError);
                    break;
                }
              }}
              width="100%"
            >
              <Button.Text adjustsFontSizeToFit>{title}</Button.Text>
              <Button.Icon>
                <Icon />
              </Button.Icon>
            </Button>
          </YStack>
        );
      })}
    </XStack>
  );
}
