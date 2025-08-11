import { exaPluginAddress, marketUSDCAddress } from "@exactly/common/generated/chain";
import { ArrowDownToLine, ArrowUpRight, HandCoins, Repeat } from "@tamagui/lucide-icons";
import { useNavigation } from "expo-router";
import React from "react";
import { XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount, useBytecode, useReadContract } from "wagmi";

import type { HomeNavigationProperties } from "../../app/(app)/(home)/_layout";
import type { AppNavigationProperties } from "../../app/(app)/_layout";
import {
  upgradeableModularAccountAbi,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "../../generated/contracts";
import type { Loan } from "../../utils/queryClient";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import Button from "../shared/StyledButton";

export default function HomeActions() {
  const homeNavigator = useNavigation<HomeNavigationProperties>("(home)");
  const appNavigator = useNavigation<AppNavigationProperties>("/(app)");
  const { address: account } = useAccount();
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
      homeNavigator.navigate("send-funds", { screen: "index" });
    } else {
      if (isPending) return;
      const { data: proposals } = await fetchProposals();
      homeNavigator.navigate("send-funds", { screen: proposals && proposals[0] > 0n ? "processing" : "index" });
    }
  };
  return (
    <XStack gap="$s4" justifyContent="space-between" width="100%">
      {actions.map(({ key, title, Icon }) => {
        if (key === "swap") return null;
        if (key === "borrow") return null;
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
                    homeNavigator.navigate("add-funds", { screen: "add-crypto" });
                    break;
                  case "send":
                    handleSend().catch(reportError);
                    break;
                  case "swap":
                    appNavigator.navigate("swaps/index");
                    break;
                  case "borrow":
                    queryClient.setQueryData<Loan>(["loan"], () => ({
                      market: marketUSDCAddress,
                      amount: undefined,
                      installments: undefined,
                      maturity: undefined,
                      receiver: undefined,
                    }));
                    homeNavigator.navigate("loan", { screen: "index" });
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
  { key: "swap", title: "Swap", Icon: Repeat },
  { key: "borrow", title: "Get Funds", Icon: HandCoins },
];
