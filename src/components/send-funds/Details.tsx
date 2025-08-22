import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import { User, Calendar, Hash, ExternalLink } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { setStringAsync } from "expo-clipboard";
import React from "react";
import { Alert, Pressable } from "react-native";
import { XStack, Avatar } from "tamagui";

import type { Withdraw } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useOpenBrowser from "../../utils/useOpenBrowser";
import Button from "../shared/Button";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Details({
  hash,
  onClose,
  isExternalAsset,
}: {
  hash?: string;
  onClose: () => void;
  isExternalAsset: boolean;
}) {
  const openBrowser = useOpenBrowser();
  const { data } = useQuery<Withdraw>({ queryKey: ["withdrawal"] });
  return (
    <View padded gap="$s4">
      {data?.receiver && (
        <XStack justifyContent="space-between" alignItems="center">
          <XStack alignItems="center" gap="$s3">
            <Avatar size={20} backgroundColor="$interactiveBaseBrandDefault" borderRadius="$r_0">
              <User size={16} color="$interactiveOnBaseBrandDefault" />
            </Avatar>
            <Text emphasized footnote color="$uiNeutralSecondary">
              To
            </Text>
          </XStack>
          <Text callout fontFamily="$mono">
            {shortenHex(data.receiver ?? "")}
          </Text>
        </XStack>
      )}
      <XStack justifyContent="space-between" alignItems="center">
        <XStack alignItems="center" gap="$s3">
          <Calendar size={20} color="$uiBrandPrimary" />
          <Text emphasized footnote color="$uiNeutralSecondary">
            Date
          </Text>
        </XStack>
        <Text callout>{format(new Date(), "yyyy-MM-dd")}</Text>
      </XStack>
      {hash && isExternalAsset && (
        <>
          <XStack
            hitSlop={15}
            justifyContent="space-between"
            alignItems="center"
            onPress={() => {
              setStringAsync(hash).catch(reportError);
              Alert.alert("Copied", "The transaction hash has been copied to the clipboard.");
            }}
          >
            <XStack alignItems="center" gap="$s3">
              <Hash size={20} color="$uiBrandPrimary" />
              <Text emphasized footnote color="$uiNeutralSecondary">
                Transaction hash
              </Text>
            </XStack>
            <Text callout fontFamily="$mono">
              {shortenHex(hash)}
            </Text>
          </XStack>
          <Button
            onPress={() => {
              openBrowser(`${chain.blockExplorers?.default.url}/tx/${hash}`).catch(reportError);
            }}
            contained
            main
            spaced
            fullwidth
            iconAfter={<ExternalLink color="$interactiveOnBaseBrandDefault" />}
          >
            View on explorer
          </Button>
        </>
      )}
      <View padded alignItems="center">
        <Pressable onPress={onClose}>
          <Text emphasized footnote color="$interactiveBaseBrandDefault">
            Close
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
