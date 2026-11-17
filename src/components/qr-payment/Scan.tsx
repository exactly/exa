import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { XStack } from "tamagui";

import RateSheet from "./RateSheet";
import { ChevronRight } from "../../generated/icons/ChevronRight";
import { currencies } from "../../utils/currencies";
import emv from "../../utils/emv";
import useInsets from "../../utils/useInsets";
import Scanner from "../send-funds/Scanner";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Scan() {
  const { bottom } = useInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const [invalid, setInvalid] = useState(false);
  const [rates, setRates] = useState(false);

  useEffect(() => {
    if (!invalid) return;
    const timer = setTimeout(() => setInvalid(false), 2000);
    return () => clearTimeout(timer);
  }, [invalid]);

  return (
    <View fullScreen position="relative" backgroundColor="backgroundSoft">
      <Scanner
        onClose={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/(main)/(home)");
        }}
        onScan={(data) => {
          if (!emv(data)) {
            setInvalid(true);
            return false;
          }
          router.push({ pathname: "/qr-payment/pay", params: { qr: data } });
          return true;
        }}
      >
        <XStack
          role="button"
          aria-label={t("QR payments exchange rate")}
          alignItems="center"
          gap="s2"
          paddingVertical="s3"
          paddingLeft="s4"
          paddingRight="s3"
          borderRadius="r_0"
          backgroundColor="backgroundSoft"
          cursor="pointer"
          opacity="1 press:0.7"
          onPress={() => {
            setRates(true);
          }}
        >
          <Text footnote emphasized primary>
            {t("Pay via QR in")}
          </Text>
          <Text footnote>{`${currencies.ARS.emoji}${currencies.BRL.emoji}`}</Text>
          <ChevronRight size={16} color="uiNeutralSecondary" />
        </XStack>
      </Scanner>
      {invalid && (
        <View
          position="absolute"
          bottom={bottom + 72}
          alignSelf="center"
          backgroundColor="interactiveBaseErrorDefault"
          borderRadius="r3"
          paddingHorizontal="s4"
          paddingVertical="s3"
        >
          <Text emphasized footnote color="interactiveOnBaseErrorDefault">
            {t("This QR code can't be used to pay.")}
          </Text>
        </View>
      )}
      <RateSheet
        open={rates}
        onClose={() => {
          setRates(false);
        }}
      />
    </View>
  );
}
