import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { ArrowRight } from "@tamagui/lucide-icons-2/icons/ArrowRight";
import { Check } from "@tamagui/lucide-icons-2/icons/Check";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";

import Checkbox from "../shared/Checkbox";
import Conversion from "../shared/Conversion";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { CardDetails } from "../../utils/server";

export default function ReceiveGuideSheet({
  asset,
  chainId,
  network,
  onClose,
  onContinue,
  open,
  symbol,
  variant,
}: {
  asset: string;
  chainId?: number;
  network: string;
  onClose: () => void;
  onContinue: (hide: boolean) => void;
  open: boolean;
  symbol: string;
  variant: "bridge" | "bridgeSwap" | "swap";
}) {
  const { t } = useTranslation();
  const [hide, setHide] = useState(false);
  const { data: card } = useQuery<CardDetails>({ queryKey: ["card", "details"] });
  const copy = {
    bridge: {
      title: t("Bridge needed after receiving"),
      description: t(
        card === null
          ? "{{asset}} on {{network}} won’t activate your Exa Card until you bridge it to {{chain}}."
          : "{{asset}} on {{network}} won’t count toward payments, collateral or yield until you bridge it to {{chain}}.",
        { asset: symbol, network, chain: chain.name },
      ),
      step: t("Bridge it to {{asset}} on {{chain}}.", { asset, chain: chain.name }),
    },
    swap: {
      title: t("Swap needed after receiving"),
      description: t(
        card === null
          ? "{{asset}} won’t activate your Exa Card until you swap it to a collateral asset."
          : "{{asset}} on {{chain}} won’t count toward payments, collateral or yield until you swap it to a collateral asset.",
        { asset: symbol, chain: chain.name },
      ),
      step: t("Swap it to a collateral asset on {{chain}}.", { chain: chain.name }),
    },
    bridgeSwap: {
      title: t("Bridge and swap needed after receiving"),
      description: t(
        card === null
          ? "{{asset}} on {{network}} won’t activate your Exa Card until you bridge it to {{chain}} and swap it to a collateral asset."
          : "{{asset}} on {{network}} won’t count toward payments, collateral or yield until you bridge it to {{chain}} and swap it to a collateral asset.",
        { asset: symbol, network, chain: chain.name },
      ),
      step: t("Bridge and swap it to a collateral asset on {{chain}}.", { chain: chain.name }),
    },
  }[variant];
  return (
    <ModalSheet
      open={open}
      onClose={() => {
        setHide(false);
        onClose();
      }}
      disableDrag
    >
      <ScrollView showsVerticalScrollIndicator={false} $platform-web={{ maxHeight: "100vh" }}>
        <SafeView
          borderTopLeftRadius="$r4"
          borderTopRightRadius="$r4"
          backgroundColor="$backgroundSoft"
          paddingHorizontal="$s5"
          $platform-web={{ paddingVertical: "$s7" }}
          $platform-android={{ paddingBottom: "$s5" }}
        >
          <YStack gap="$s5">
            <Text emphasized primary headline>
              {card === null ? t("This won’t activate your Exa Card yet") : copy.title}
            </Text>
            <Text subHeadline secondary>
              {copy.description}
            </Text>
            <Conversion symbol={symbol} chainId={chainId} target={variant === "bridge" ? asset : undefined} />
            <YStack gap="$s4_5">
              <Step index={1} text={t("Once it arrives, go to your Portfolio.")} />
              <Step index={2} text={t("Find {{asset}} on {{network}} and select it.", { asset: symbol, network })} />
              <Step index={3} text={copy.step} />
            </YStack>
            <Button
              primary
              width="100%"
              onPress={() => {
                setHide(false);
                onContinue(hide);
              }}
            >
              <Button.Text adjustsFontSizeToFit={false}>{t("Continue")}</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
            <Pressable role="checkbox" aria-checked={hide} onPress={() => setHide(!hide)}>
              <XStack gap="$s3" alignItems="center" justifyContent="center">
                <Checkbox borderColor="$uiNeutralSecondary" checked={hide}>
                  <Checkbox.Indicator>
                    <Check size={16} color="$interactiveOnBaseBrandDefault" />
                  </Checkbox.Indicator>
                </Checkbox>
                <Text footnote secondary>
                  {t("Don't show again")}
                </Text>
              </XStack>
            </Pressable>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}

function Step({ index, text }: { index: number; text: string }) {
  return (
    <XStack gap="$s3_5" alignItems="center">
      <View
        width={24}
        height={24}
        borderRadius="$r_0"
        backgroundColor="$interactiveBaseBrandSoftDefault"
        alignItems="center"
        justifyContent="center"
      >
        <Text emphasized subHeadline color="$interactiveOnBaseBrandSoft">
          {index}
        </Text>
      </View>
      <Text subHeadline secondary flex={1}>
        {text}
      </Text>
    </XStack>
  );
}
