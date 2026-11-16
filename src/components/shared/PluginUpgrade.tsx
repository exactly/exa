import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { toast } from "@tamagui/toast";

import { queryOptions, skipToken, useIsMutating, useQueries, useQuery } from "@tanstack/react-query";
import { readContract, waitForCallsStatus } from "@wagmi/core/actions";
import {
  decodeErrorResult,
  encodeAbiParameters,
  encodeErrorResult,
  encodeFunctionData,
  getAbiItem,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { simulateBlocks } from "viem/actions";
import { useSendCalls } from "wagmi";
import { readContractQueryOptions } from "wagmi/query";

import accountInit from "@exactly/common/accountInit";
import { appPreviewerAbi, appPreviewerCode, chains } from "@exactly/common/generated/chain";
import { exaPluginAbi, upgradeableModularAccountAbi } from "@exactly/common/generated/hooks";

import InfoAlert from "./InfoAlert";
import deployedOptions from "../../utils/deployedOptions";
import queryClient from "../../utils/queryClient";
import reportError, { classifyError } from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useSingleMutation from "../../utils/useSingleMutation";
import exa from "../../utils/wagmi/exa";

import type { Credential } from "@exactly/common/validation";

export default function PluginUpgrade() {
  const { t } = useTranslation();
  const { mutateAsync: mutateSendCalls } = useSendCalls();
  const { address } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const outdated = useQueries({
    queries: [...chains.keys()].map((chainId) => upgradeOptions(address, credential, chainId)),
    combine: (results) => results.some(({ data }) => !!data),
  });
  const [progress, setProgress] = useState<{ current: number; total: number }>();
  const upgrading = useIsMutating({ mutationKey: ["pluginUpgrade"] }) > 0;
  const { mutate: updatePlugin } = useSingleMutation({
    mutationKey: ["pluginUpgrade"],
    mutationFn: async () => {
      if (!address || !credential) throw new Error("no account");
      const upgrades = await Promise.all(
        [...chains.keys()].map((chainId) => queryClient.fetchQuery(upgradeOptions(address, credential, chainId))),
      ).then((checks) => checks.flatMap((check) => check ?? []));
      let deferred = false;
      let failure: Error | undefined;
      for (const [index, { chainId, upgrade, calldata, pendingProposalsAt }] of upgrades.entries()) {
        setProgress({ current: index + 1, total: upgrades.length });
        try {
          let calls = upgrade;
          if (pendingProposalsAt !== undefined) {
            const proposals = await readContract(exa, {
              chainId,
              abi: appPreviewerAbi,
              code: appPreviewerCode,
              functionName: "pendingProposals",
              args: [address],
            });
            const last = proposals.at(-1);
            if (last === undefined || last.unlock + 3600n > pendingProposalsAt) {
              deferred = true;
              continue;
            }
            const resolutions: Hex[] = [];
            for (const { nonce } of proposals) {
              const execution = encodeFunctionData({
                abi: exaPluginAbi,
                functionName: "executeProposal",
                args: [nonce],
              });
              const skip = encodeFunctionData({
                abi: exaPluginAbi,
                functionName: "setProposalNonce",
                args: [nonce + 1n],
              });
              const block = await simulate(address, chainId, [...resolutions, execution, skip]);
              const executed = block?.calls.at(-2)?.status === "success";
              const nonceConsumed = block?.calls.at(-1)?.status === "failure";
              if (executed && !nonceConsumed)
                reportError(new Error("upgrade skipped executable proposal"), { level: "warning" });
              resolutions.push(executed && nonceConsumed ? execution : skip);
            }
            calls = [
              ...resolutions.map((data) => ({ target: address, value: 0n, data })),
              { target: address, value: 0n, data: calldata },
            ];
            const resolved = await simulate(address, chainId, [
              encodeFunctionData({ abi: upgradeableModularAccountAbi, functionName: "executeBatch", args: [calls] }),
            ]);
            if (resolved?.calls[0]?.status !== "success") {
              deferred = true;
              continue;
            }
          }
          const { id } = await mutateSendCalls({
            chainId,
            calls: calls.map(({ target, data }) => ({ to: target, data })),
          });
          const { status } = await waitForCallsStatus(exa, { id });
          Promise.all([
            queryClient.invalidateQueries({ queryKey: installedOptions(address, credential, chainId).queryKey }),
            queryClient.invalidateQueries({ queryKey: ["pluginUpgrade", address, chainId] }),
          ]).catch(reportError);
          if (status === "failure") throw new Error("failed to upgrade plugin");
        } catch (error) {
          if (!(error instanceof Error) || classifyError(error).authKnown) throw error;
          failure ??= error;
        }
      }
      if (failure) throw failure;
      return deferred ? "pending" : undefined;
    },
    onSettled() {
      setProgress(undefined);
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

  if (!outdated) return null;

  return (
    <InfoAlert
      title={t("An account upgrade is required to access the latest features.")}
      actionText={
        progress && progress.total > 1 ? t("Upgrading {{current}} of {{total}}", progress) : t("Upgrade account now")
      }
      loading={upgrading}
      onPress={() => {
        updatePlugin();
      }}
    />
  );
}

function installedOptions(account: Address, credential: Credential, chainId: number) {
  return readContractQueryOptions(exa, {
    address: account,
    chainId,
    abi: upgradeableModularAccountAbi,
    functionName: "getInstalledPlugins",
    factory: credential.factory,
    factoryData: accountInit(credential),
  });
}

function upgradeOptions(account: Address | undefined, credential: Credential | undefined, chainId: number) {
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- account derives from credential
  return queryOptions({
    queryKey: ["pluginUpgrade", account, chainId],
    queryFn:
      account && credential
        ? async () => {
            const latest = chains.get(chainId)?.exaPlugin;
            if (!latest || !(await queryClient.fetchQuery(deployedOptions(account, chainId)))) return null;
            const [installed] = await queryClient.fetchQuery(installedOptions(account, credential, chainId));
            if (!installed || installed === latest) return null;
            const upgrade = [
              {
                target: account,
                value: 0n,
                data: encodeFunctionData({
                  abi: upgradeableModularAccountAbi,
                  functionName: "uninstallPlugin",
                  args: [
                    installed,
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
                target: account,
                value: 0n,
                data: encodeFunctionData({
                  abi: upgradeableModularAccountAbi,
                  functionName: "installPlugin",
                  args: [
                    latest,
                    keccak256(
                      encodeAbiParameters(getAbiItem({ abi: exaPluginAbi, name: "pluginManifest" }).outputs, [
                        await readContract(exa, {
                          chainId,
                          address: latest,
                          abi: exaPluginAbi,
                          functionName: "pluginManifest",
                        }),
                      ]),
                    ),
                    "0x",
                    [],
                  ],
                }),
              },
            ];
            const calldata = encodeFunctionData({
              abi: upgradeableModularAccountAbi,
              functionName: "executeBatch",
              args: [upgrade],
            });
            const block = await simulate(account, chainId, [calldata]);
            const [call] = block?.calls ?? [];
            if (call?.status === "success") return { chainId, upgrade, calldata, pendingProposalsAt: undefined };
            if (block && pending(call)) return { chainId, upgrade, calldata, pendingProposalsAt: block.timestamp };
            reportError(new Error("plugin upgrade simulation failed", { cause: { chainId, installed, call } }), {
              level: "warning",
            });
            return null;
          }
        : skipToken,
  });
}

async function simulate(account: Address, chainId: number, calls: Hex[]) {
  const [block] = await simulateBlocks(exa.getClient({ chainId }), {
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
