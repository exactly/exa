import React from "react";
import { Trans } from "react-i18next";

import { TriangleAlert } from "@tamagui/lucide-icons-2/icons/TriangleAlert";
import { AnimatePresence, XStack } from "tamagui";

import Text from "./Text";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";

export default function MarketClosedBanner({ open }: { open: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <XStack
          key="market"
          transition="default"
          animateOnly={["opacity", "transform"]}
          enterStyle={{ opacity: 0, transform: [{ translateY: -8 }] }}
          exitStyle={{ opacity: 0, transform: [{ translateY: -8 }] }}
          gap="$s3"
          alignItems="flex-start"
          backgroundColor="$interactiveBaseWarningSoftDefault"
          borderRadius="$r3"
          paddingHorizontal="$s4"
          paddingVertical="$s3"
        >
          <TriangleAlert size={16} color="$uiWarningSecondary" y={1} />
          <Text caption color="$uiWarningSecondary" flex={1}>
            <Trans
              i18nKey="The stock market is closed. This price is set by token trading and may not match the stock’s last close or its price when the market reopens.<learn> Learn more about tokenized stocks.</learn>"
              components={{
                learn: (
                  <Text
                    caption
                    color="$uiNeutralPrimary"
                    cursor="pointer"
                    onPress={() => {
                      presentArticle("17155255").catch(reportError);
                    }}
                  />
                ),
              }}
            />
          </Text>
        </XStack>
      )}
    </AnimatePresence>
  );
}
