import { exaPluginAddress, marketUSDCAddress } from "@exactly/common/generated/chain";
import { ArrowDownToLine, ArrowUpRight, HandCoins, Repeat } from "@tamagui/lucide-icons";
import { router } from "expo-router";
import React from "react";
import { Spinner, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount, useBytecode, useReadContract } from "wagmi";

import {
  upgradeableModularAccountAbi,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "../../generated/contracts";
import type { Loan } from "../../utils/queryClient";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import Button from "../shared/Button";
import Text from "../shared/Text";

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
    <XStack gap="$s4" flexWrap="wrap" width="100%" justifyContent="space-between">
      {actions.map(({ key, title, icon }) => (
        <YStack key={key} alignItems="center" justifyContent="center" gap="$s3_5" flex={1}>
          <Button
            contained={key === "deposit"}
            outlined={key !== "deposit"}
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
            cursor="pointer"
            icon={
              key === "send" && !isLatestPlugin && isPending ? (
                <Spinner height={18} width={18} color="$interactiveOnBaseBrandSoft" />
              ) : (
                icon
              )
            }
            width="100%"
          />
          <Text footnote adjustsFontSizeToFit color="$backgroundBrand" flex={1}>
            {title}
          </Text>
        </YStack>
      ))}
    </XStack>
  );
}

const actions = [
  {
    key: "deposit",
    title: "Deposit",
    icon: <ArrowDownToLine size={18} color="$interactiveOnBaseBrandDefault" />,
  },
  {
    key: "send",
    title: "Send",
    icon: <ArrowUpRight size={18} color="$interactiveOnBaseBrandSoft" />,
  },
  {
    key: "swap",
    title: "Swap",
    icon: <Repeat size={18} color="$interactiveOnBaseBrandSoft" />,
  },
  {
    key: "borrow",
    title: "Borrow",
    icon: <HandCoins size={18} color="$interactiveOnBaseBrandSoft" />,
  },
];
