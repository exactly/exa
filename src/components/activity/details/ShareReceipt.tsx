import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { PixelRatio, Platform, Share } from "react-native";
import type Svg from "react-native-svg";

import { setImageAsync } from "expo-clipboard";
import { Directory, File, Paths } from "expo-file-system";

import { Share as ShareIcon } from "@tamagui/lucide-icons-2";
import { useToastController } from "@tamagui/toast";
import { Theme, YStack } from "tamagui";

import { useMutation } from "@tanstack/react-query";

import Receipt, { size } from "./Receipt";
import reportError from "../../../utils/reportError";
import useAccount from "../../../utils/useAccount";
import Button from "../../shared/StyledButton";

import type { ActivityItem } from "../../../utils/queryClient";

export default function ShareReceipt({ item }: { item: Extract<ActivityItem, { type: "sent" }> }) {
  const { t } = useTranslation();
  const { address: account } = useAccount();
  const toast = useToastController();
  const ref = useRef<Svg>(null);
  const { mutate: share, isPending: sharing } = useMutation({
    async mutationFn() {
      const svg = ref.current;
      if (!svg) throw new Error("missing receipt");
      const base64 = await new Promise<string>((resolve) => {
        svg.toDataURL(
          resolve,
          Platform.OS === "ios"
            ? { width: size.width / PixelRatio.get(), height: size.height / PixelRatio.get() }
            : size,
        );
      });
      const name = `exa-receipt-${item.transactionHash.slice(2, 10)}.png`;
      switch (Platform.OS) {
        case "web": {
          const blob = await fetch(`data:image/png;base64,${base64}`).then((response) => response.blob());
          const files = [new globalThis.File([blob], name, { type: "image/png" })];
          if ("canShare" in navigator && navigator.canShare({ files })) {
            await navigator.share({ files }).catch((error: unknown) => {
              if (error instanceof DOMException && error.name === "AbortError") return;
              throw error;
            });
            return;
          }
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = name;
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
          return t("Receipt downloaded!");
        }
        case "android": {
          await setImageAsync(base64);
          const directory = await Directory.pickDirectoryAsync().catch((error: unknown) => {
            if (error instanceof Error && "code" in error && error.code === "ERR_PICKER_CANCELLED") return;
            throw error;
          });
          if (!directory) return t("Receipt copied!");
          directory.createFile(name, "image/png").write(base64, { encoding: "base64" });
          return t("Receipt saved and copied!");
        }
        default: {
          const file = new File(Paths.cache, name);
          file.create({ overwrite: true });
          file.write(base64, { encoding: "base64" });
          await Share.share({ url: file.uri });
        }
      }
    },
    onSuccess(message) {
      if (message) toast.show(message, { duration: 1500, burntOptions: { haptic: "success" } });
    },
    onError(error) {
      reportError(error);
      toast.show(t("Couldn't share the receipt. Please try again."), {
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
  });
  return (
    <>
      <YStack position="absolute" width={0} height={0} overflow="hidden" pointerEvents="none" aria-hidden>
        <YStack position="absolute">
          <Theme name="light">
            <Receipt ref={ref} account={account} item={item} />
          </Theme>
        </YStack>
      </YStack>
      <Button
        primary
        width="100%"
        disabled={sharing}
        loading={sharing}
        onPress={() => {
          share();
        }}
      >
        <Button.Text>{t("Share receipt")}</Button.Text>
        <Button.Icon>
          <ShareIcon />
        </Button.Icon>
      </Button>
    </>
  );
}
