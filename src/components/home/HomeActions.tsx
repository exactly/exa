import { exaPluginAddress } from "@exactly/common/generated/chain";
import { ArrowDownToLine, ArrowUpRight } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React from "react";
import { XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useBytecode, useReadContract } from "wagmi";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import {
  upgradeableModularAccountAbi,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "../../generated/contracts";
import type { AuthMethod } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import Button from "../shared/StyledButton";

export default function HomeActions() {
  const navigation = useNavigation<AppNavigationProperties>("/(main)");
  const { address: account } = useAccount();
  const { data: method } = useQuery<AuthMethod>({ queryKey: ["method"] });
  const { data: bytecode } = useBytecode({ address: account ?? zeroAddress, query: { enabled: !!account } });

  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: account ?? zeroAddress,
    query: { enabled: !!account && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
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
      navigation.navigate("send-funds", { screen: "index" });
    } else {
      if (isPending) return;
      const { data: proposals } = await fetchProposals();
      if (proposals && proposals[0] > 0n) {
        navigation.navigate("pending-proposals/index");
      } else {
        navigation.navigate("send-funds", { screen: "index" });
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
                        navigation.navigate("add-funds", { screen: "index" });
                        break;
                      default:
                        navigation.navigate("add-funds", { screen: "add-crypto" });
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

const actions = [
  { key: "deposit", title: "Add funds", Icon: ArrowDownToLine },
  { key: "send", title: "Send", Icon: ArrowUpRight },
];
