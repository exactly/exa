import { exaPluginAddress, marketUSDCAddress } from "@exactly/common/generated/chain";
import { ArrowDownToLine, ArrowUpRight, HandCoins, Repeat } from "@tamagui/lucide-icons";
import { router } from "expo-router";
import React from "react";
import { XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount, useBytecode, useReadContract } from "wagmi";

import {
  upgradeableModularAccountAbi,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "../../generated/contracts";
import type { Loan } from "../../utils/queryClient";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import Button from "../shared/StyledButton";

export default function HomeActions() {
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
      router.push("/send-funds");
    } else {
      if (isPending) return;
      const { data: proposals } = await fetchProposals();
      const route = proposals && proposals[0] > 0n ? "/send-funds/processing" : "/send-funds";
      router.push(route);
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
                    router.push("/add-funds/add-crypto");
                    break;
                  case "send":
                    handleSend().catch(reportError);
                    break;
                  case "swap":
                    router.push("/swaps");
                    break;
                  case "borrow":
                    queryClient.setQueryData<Loan>(["loan"], () => ({
                      market: marketUSDCAddress,
                      amount: undefined,
                      installments: undefined,
                      maturity: undefined,
                      receiver: undefined,
                    }));
                    router.push("/(app)/(home)/loans");
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
  { key: "borrow", title: "Borrow", Icon: HandCoins },
];
