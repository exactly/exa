import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { useToastController } from "@tamagui/toast";

import { parse, safeParse } from "valibot";
import { zeroAddress } from "viem";

import { Address } from "@exactly/common/validation";

import Scanner from "./Scanner";

export default function QR() {
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToastController();

  return (
    <Scanner
      onClose={() => {
        if (router.canGoBack()) router.back();
        else router.replace("/send-funds");
      }}
      onScan={(data) => {
        const result = safeParse(Address, data);
        if (!result.success || result.output === parse(Address, zeroAddress)) {
          toast.show(t("Couldn't read this QR code. Make sure it's a valid address."), {
            duration: 3000,
            burntOptions: { haptic: "error", preset: "error" },
          });
          return false;
        }
        router.dismissTo({ pathname: "/send-funds/asset", params: { receiver: result.output } });
        return true;
      }}
    />
  );
}
