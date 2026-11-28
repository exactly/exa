import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { getTokens, XStack, YStack } from "tamagui";

import RateSheet from "./RateSheet";
import ARS from "../../assets/images/flag-ars.svg";
import BRL from "../../assets/images/flag-brl.svg";
import { ChevronRight } from "../../generated/icons/ChevronRight";
import emv from "../../utils/emv";
import Scanner from "../send-funds/Scanner";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Scan() {
  const router = useRouter();
  const { t } = useTranslation();
  const [invalid, setInvalid] = useState(false);
  const [rates, setRates] = useState(false);
  const flag = getTokens().size["1.5"].val;

  useEffect(() => {
    if (!invalid) return;
    const timer = setTimeout(() => setInvalid(false), 2000);
    return () => clearTimeout(timer);
  }, [invalid]);

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace("/(main)/(home)");
  }

  function scan(data: string) {
    if (!emv(data)?.currency) {
      setInvalid(true);
      return false;
    }
    router.push({ pathname: "/qr-payment/pay", params: { qr: data } });
    return true;
  }

  return (
    <View fullScreen position="relative" backgroundColor="backgroundSoft">
      <Scanner framed paused={rates} onClose={close} onScan={scan}>
        <YStack alignItems="center" gap="s4">
          {invalid && (
            <View
              backgroundColor="interactiveBaseErrorDefault"
              borderRadius="r3"
              paddingHorizontal="s4"
              paddingVertical="s3"
            >
              <Text emphasized footnote color="interactiveOnBaseErrorDefault">
                {t("This QR code isn't supported yet. Try another one.")}
              </Text>
            </View>
          )}
          <XStack
            role="button"
            tabIndex={0}
            aria-label={t("QR payments exchange rate")}
            alignItems="center"
            gap="s2"
            paddingVertical="s4"
            paddingHorizontal="s5"
            borderRadius="r_0"
            backgroundColor="grayscaleLight11"
            cursor="pointer"
            opacity="1 press:0.7"
            onPress={() => {
              setRates(true);
            }}
          >
            <Text footnote emphasized color="grayscaleLight1">
              {t("Scan a QR to pay in")}
            </Text>
            <XStack alignItems="center">
              <View marginRight={-flag / 4}>
                <ARS width={flag} height={flag} />
              </View>
              <BRL width={flag} height={flag} />
            </XStack>
            <ChevronRight size={getTokens().iconSize.md.val} color={getTokens().color.grayscaleLight1.val} />
          </XStack>
        </YStack>
      </Scanner>
      <RateSheet
        open={rates}
        onClose={() => {
          setRates(false);
        }}
      />
    </View>
  );
}
