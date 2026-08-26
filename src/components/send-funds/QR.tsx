import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useRouter } from "expo-router";

import { safeParse } from "valibot";

import Scanner from "./Scanner";
import { chainTypeOf, receiverSchema } from "../../utils/lifi";
import Text from "../shared/Text";
import View from "../shared/View";

export default function QR() {
  const { bottom } = useSafeAreaInsets();
  const router = useRouter();
  const [invalid, setInvalid] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (!invalid) return;
    const timer = setTimeout(() => setInvalid(false), 2000);
    return () => clearTimeout(timer);
  }, [invalid]);

  return (
    <View fullScreen position="relative" backgroundColor="$backgroundSoft">
      <Scanner
        onClose={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/send-funds");
        }}
        onScan={(data) => {
          const [locator = "", query = ""] = data.split("?");
          const [target = "", method] = locator.slice(locator.lastIndexOf(":") + 1).split("/");
          const [recipient = ""] = (
            method === "transfer"
              ? (/(?:^|&)address=([^&]*)/.exec(query)?.[1] ?? "")
              : method
                ? ""
                : target.replace(/^pay-/, "")
          ).split("@");
          const chainType = chainTypeOf(recipient);
          const result = chainType && safeParse(receiverSchema(chainType), recipient);
          if (!result?.success) {
            setInvalid(true);
            return false;
          }
          router.dismissTo({ pathname: "/send-funds/receiver", params: { receiver: result.output } });
          return true;
        }}
      />
      {invalid && (
        <View
          position="absolute"
          bottom={bottom + 72}
          alignSelf="center"
          backgroundColor="$interactiveBaseErrorDefault"
          borderRadius="$r3"
          paddingHorizontal="$s4"
          paddingVertical="$s3"
        >
          <Text emphasized footnote color="$interactiveOnBaseErrorDefault">
            {t("Couldn't read this QR code. Make sure it's a valid address.")}
          </Text>
        </View>
      )}
    </View>
  );
}
