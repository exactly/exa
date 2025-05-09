import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { borrowLimit, withdrawLimit } from "@exactly/lib";
import { Info } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Pressable } from "react-native";
import { View } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import { useReadPreviewerExactly } from "../../generated/contracts";
import reportError from "../../utils/reportError";
import { getCard } from "../../utils/server";
import useIntercom from "../../utils/useIntercom";
import Text from "../shared/Text";

export default function CardLimits() {
  const { data: card } = useQuery({ queryKey: ["card", "details"], queryFn: getCard });
  const isCredit = card ? card.mode > 0 : false;
  const { address } = useAccount();
  const { presentArticle } = useIntercom();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });
  return (
    <View display="flex" justifyContent="center" backgroundColor="$backgroundSoft" gap="$s4">
      <View display="flex" flexDirection="row" justifyContent="center" alignItems="center" gap="$s2">
        <Text emphasized subHeadline color="$uiNeutralSecondary" textAlign="center">
          Spending limit
        </Text>
        <Pressable
          onPress={() => {
            presentArticle("9922633").catch(reportError);
          }}
          hitSlop={15}
        >
          <Info size={16} color="$uiBrandSecondary" />
        </Pressable>
      </View>

      <View
        alignSelf="center"
        justifyContent="center"
        alignItems="center"
        backgroundColor={isCredit ? "$cardCreditInteractive" : "$cardDebitInteractive"}
        borderRadius="$r2"
        paddingVertical="$s2"
        paddingHorizontal="$s3"
      >
        <Text
          emphasized
          textTransform="uppercase"
          color={isCredit ? "$cardCreditText" : "$cardDebitText"}
          maxFontSizeMultiplier={1}
        >
          {isCredit ? `Pay in ${card?.mode} installments enabled` : "Pay Now enabled"}
        </Text>
      </View>

      <View display="flex" justifyContent="center" alignItems="center">
        <Text sensitive textAlign="center" fontFamily="$mono" fontSize={40} overflow="hidden" maxFontSizeMultiplier={1}>
          {(markets
            ? Number(isCredit ? borrowLimit(markets, marketUSDCAddress) : withdrawLimit(markets, marketUSDCAddress)) /
              1e6
            : 0
          ).toLocaleString(undefined, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" })}
        </Text>
      </View>
    </View>
  );
}
