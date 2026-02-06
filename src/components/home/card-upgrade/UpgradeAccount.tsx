import React from "react";
import { useTranslation } from "react-i18next";

import { ArrowUpToLine } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { YStack } from "tamagui";

import { useMutation, useQuery } from "@tanstack/react-query";
import { waitForCallsStatus } from "@wagmi/core/actions";
import { encodeAbiParameters, getAbiItem, keccak256 } from "viem";
import { useSendCalls } from "wagmi";

import accountInit from "@exactly/common/accountInit";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain, { exaPluginAddress } from "@exactly/common/generated/chain";
import {
  exaPluginAbi,
  upgradeableModularAccountAbi,
  useReadExaPluginPluginManifest,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "@exactly/common/generated/hooks";

import Progression from "./Progression";
import queryClient from "../../../utils/queryClient";
import reportError from "../../../utils/reportError";
import useAccount from "../../../utils/useAccount";
import exa from "../../../utils/wagmi/exa";
import Button from "../../shared/Button";
import Spinner from "../../shared/Spinner";
import Text from "../../shared/Text";
import View from "../../shared/View";

import type { Credential } from "@exactly/common/validation";

export default function UpgradeAccount() {
  const { mutateAsync: mutateSendCalls } = useSendCalls();
  const { address } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: installedPlugins, refetch: refetchInstalledPlugins } =
    useReadUpgradeableModularAccountGetInstalledPlugins({
      address,
      factory: credential?.factory,
      factoryData: credential && accountInit(credential),
      query: { refetchOnMount: true, enabled: !!address && !!credential },
    });
  const { data: pluginManifest } = useReadExaPluginPluginManifest({ address: exaPluginAddress });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;

  const toast = useToastController();
  const { data: step } = useQuery<number | undefined>({ queryKey: ["card-upgrade"] });
  const { t } = useTranslation();
  const { mutateAsync: upgradeAccount, isPending: isUpgrading } = useMutation({
    mutationFn: async () => {
      if (isLatestPlugin) {
        queryClient.setQueryData(["card-upgrade"], 2);
        return;
      }
      if (!address) throw new Error("no account address");
      if (!installedPlugins?.[0]) throw new Error("no installed plugin");
      if (!pluginManifest) throw new Error("invalid manifest");

      const { id } = await mutateSendCalls({
        calls: [
          {
            to: address,
            abi: upgradeableModularAccountAbi,
            functionName: "uninstallPlugin",
            args: [installedPlugins[0], "0x", "0x"],
          },
          {
            to: address,
            abi: upgradeableModularAccountAbi,
            functionName: "installPlugin",
            args: [
              exaPluginAddress,
              keccak256(
                encodeAbiParameters(getAbiItem({ abi: exaPluginAbi, name: "pluginManifest" }).outputs, [
                  pluginManifest,
                ]),
              ),
              "0x",
              [],
            ],
          },
        ],
        capabilities: {
          paymasterService: {
            url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
            context: { policyId: alchemyGasPolicyId },
          },
        },
      });

      const { status } = await waitForCallsStatus(exa, { id });
      if (status === "failure") throw new Error("failed to upgrade account");
    },
    onSuccess: async () => {
      toast.show(t("Account upgraded!"), { native: true, duration: 1000, burntOptions: { haptic: "success" } });
      queryClient.setQueryData(["card-upgrade"], 2);
      await refetchInstalledPlugins();
    },
    onError: () => {
      toast.show(t("Error upgrading account"), {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
  });
  return (
    <View fullScreen flex={1} gap="$s6" paddingHorizontal="$s5" paddingTop="$s5" backgroundColor="$backgroundSoft">
      {isUpgrading ? (
        <YStack gap="$s6" justifyContent="center" alignItems="center">
          <Spinner color="$uiNeutralPrimary" backgroundColor="$backgroundMild" containerSize={52} size={32} />
          <YStack gap="$s2" justifyContent="center" alignItems="center">
            <Text emphasized title3 color="$uiNeutralSecondary">
              {t("Updating your account")}
            </Text>
            <Text color="$uiNeutralSecondary" footnote>
              {t("STEP {{current}} OF {{total}}", { current: (step ?? 0) + 1, total: 3 })}
            </Text>
          </YStack>
          <Text color="$uiNeutralSecondary" subHeadline alignSelf="center" textAlign="center">
            {t("This may take a moment. Please wait.")}
          </Text>
        </YStack>
      ) : (
        <>
          <YStack gap="$s4">
            <ArrowUpToLine size={32} color="$uiBrandSecondary" />
            <Text emphasized title3 color="$uiBrandSecondary">
              {t("Upgrade your account")}
            </Text>
          </YStack>
          <YStack>
            <Text color="$uiNeutralSecondary" subHeadline>
              {t(
                "Update your Exa account to support our new card provider. This quick step ensures a smooth transition to your upgraded Exa Card.",
              )}
            </Text>
          </YStack>
          <Progression />
        </>
      )}
      <YStack paddingBottom="$s7">
        <Button
          disabled={isUpgrading}
          onPress={() => {
            upgradeAccount().catch(reportError);
          }}
          flexBasis={60}
          contained
          main
          spaced
          fullwidth
          backgroundColor={isUpgrading ? "$interactiveDisabled" : "$interactiveBaseBrandDefault"}
          color={isUpgrading ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandDefault"}
          iconAfter={
            <ArrowUpToLine
              strokeWidth={2.5}
              color={isUpgrading ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandDefault"}
            />
          }
        >
          {t("Upgrade account now")}
        </Button>
      </YStack>
    </View>
  );
}
