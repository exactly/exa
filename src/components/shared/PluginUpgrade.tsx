import React from "react";
import { useTranslation } from "react-i18next";

import { toast } from "@tamagui/toast";

import { useMutation, useQuery } from "@tanstack/react-query";
import { readContract, waitForCallsStatus } from "@wagmi/core/actions";
import {
  decodeErrorResult,
  encodeAbiParameters,
  encodeDeployData,
  encodeErrorResult,
  encodeFunctionData,
  getAbiItem,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { simulateBlocks } from "viem/actions";
import { useBytecode, useSendCalls } from "wagmi";

import accountInit from "@exactly/common/accountInit";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain, {
  auditorAddress,
  exaPluginAddress,
  exaPreviewerCode,
  marketUSDCAddress,
} from "@exactly/common/generated/chain";
import {
  exaPluginAbi,
  exaPreviewerAbi,
  upgradeableModularAccountAbi,
  useReadExaPluginPluginManifest,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "@exactly/common/generated/hooks";

import InfoAlert from "./InfoAlert";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import exa from "../../utils/wagmi/exa";

import type { Credential } from "@exactly/common/validation";

export default function PluginUpgrade() {
  const { t } = useTranslation();
  const { mutateAsync: mutateSendCalls } = useSendCalls();
  const { address } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: bytecode } = useBytecode({ address, chainId: chain.id, query: { enabled: !!address } });
  const { data: installedPlugins, refetch: refetchInstalledPlugins } =
    useReadUpgradeableModularAccountGetInstalledPlugins({
      address,
      chainId: chain.id,
      factory: credential?.factory,
      factoryData: credential && accountInit(credential),
      query: { refetchOnMount: true, enabled: !!address && !!credential },
    });
  const { data: pluginManifest } = useReadExaPluginPluginManifest({ address: exaPluginAddress, chainId: chain.id });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  const isReady = !!bytecode && !!installedPlugins?.[0] && !!pluginManifest && !isLatestPlugin;
  const { mutate: updatePlugin, isPending: isUpdating } = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("no account address");
      if (!installedPlugins?.[0]) throw new Error("no installed plugin");
      if (!pluginManifest) throw new Error("invalid manifest");

      const upgrade = [
        {
          target: address,
          value: 0n,
          data: encodeFunctionData({
            abi: upgradeableModularAccountAbi,
            functionName: "uninstallPlugin",
            args: [
              installedPlugins[0],
              encodeAbiParameters(
                [
                  {
                    type: "tuple",
                    components: [
                      { name: "serializedManifest", type: "bytes" },
                      { name: "forceUninstall", type: "bool" },
                      { name: "callbackGasLimit", type: "uint256" },
                    ],
                  },
                ],
                [{ serializedManifest: "0x", forceUninstall: true, callbackGasLimit: 0n }],
              ),
              "0x",
            ],
          }),
        },
        {
          target: address,
          value: 0n,
          data: encodeFunctionData({
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
          }),
        },
      ];
      const batch = encodeFunctionData({
        abi: upgradeableModularAccountAbi,
        functionName: "executeBatch",
        args: [upgrade],
      });
      let calls = upgrade;
      const simulation = await simulate(address, [batch]);
      if (simulation && pending(simulation.calls[0])) {
        const proposals = await readContract(exa, {
          abi: exaPreviewerAbi,
          code: encodeDeployData({
            abi: exaPreviewerAbi,
            bytecode: exaPreviewerCode,
            args: [
              auditorAddress,
              marketUSDCAddress,
              await readContract(exa, {
                address: installedPlugins[0],
                abi: exaPluginAbi,
                functionName: "proposalManager",
              }),
            ],
          }),
          functionName: "pendingProposals",
          args: [address],
        });
        const last = proposals.at(-1);
        if (last === undefined || last.unlock + 3600n > simulation.timestamp) return "pending";
        const resolutions: Hex[] = [];
        for (const { nonce } of proposals) {
          const execution = encodeFunctionData({ abi: exaPluginAbi, functionName: "executeProposal", args: [nonce] });
          const block = await simulate(address, [...resolutions, execution]);
          resolutions.push(
            block?.calls.at(-1)?.status === "success"
              ? execution
              : encodeFunctionData({ abi: exaPluginAbi, functionName: "setProposalNonce", args: [nonce + 1n] }),
          );
        }
        calls = [
          ...resolutions.map((data) => ({ target: address, value: 0n, data })),
          { target: address, value: 0n, data: batch },
        ];
        const resolved = await simulate(address, [
          encodeFunctionData({ abi: upgradeableModularAccountAbi, functionName: "executeBatch", args: [calls] }),
        ]);
        if (resolved?.calls[0]?.status !== "success") return "pending";
      }
      const { id } = await mutateSendCalls({
        chainId: chain.id,
        calls: calls.map(({ target, data }) => ({ to: target, data })),
        capabilities: {
          paymasterService: {
            url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
            context: { policyId: alchemyGasPolicyId },
          },
        },
      });
      const { status } = await waitForCallsStatus(exa, { id });
      if (status === "failure") throw new Error("failed to upgrade plugin");
      if (credential) await refetchInstalledPlugins();
    },
    onSuccess(result) {
      if (result === "pending") {
        toast.warning(t("Your account has pending requests. Try upgrading again in a moment."), { duration: 3000 });
        return;
      }
      toast.success(t("Account upgraded!"), { duration: 1000 });
    },
    onError(error) {
      if (!reportError(error).authKnown) {
        toast.error(t("Error upgrading account"), { duration: 1000 });
      }
    },
  });

  if (!isReady) return null;

  return (
    <InfoAlert
      title={t("An account upgrade is required to access the latest features.")}
      actionText={t("Upgrade account now")}
      loading={isUpdating}
      onPress={() => {
        updatePlugin();
      }}
    />
  );
}

async function simulate(account: Address, calls: Hex[]) {
  const [block] = await simulateBlocks(exa.getClient({ chainId: chain.id }), {
    blocks: [{ calls: calls.map((data) => ({ account, to: account, data })) }],
  });
  return block;
}

function pending(call: undefined | { data: Hex; status: "failure" | "success" }) {
  if (call?.status !== "failure") return false;
  try {
    const { errorName, args } = decodeErrorResult({ abi: upgradeableModularAccountAbi, data: call.data });
    return (
      errorName === "PreExecHookReverted" &&
      args[2] === encodeErrorResult({ abi: exaPluginAbi, errorName: "PendingProposals" })
    );
  } catch {
    return false;
  }
}
