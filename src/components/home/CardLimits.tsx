import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { borrowLimit, withdrawLimit } from "@exactly/lib";
import { Info } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Pressable } from "react-native";
import { ms } from "react-native-size-matters";
import { View } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import { useReadPreviewerExactly } from "../../generated/contracts";
import handleError from "../../utils/handleError";
import { getCard } from "../../utils/server";
import useIntercom from "../../utils/useIntercom";
import Text from "../shared/Text";

export default function CardLimits() {
  const { data: card } = useQuery({ queryKey: ["card", "details"], queryFn: getCard });
  const isCredit = card ? card.mode > 0 : false;

  const { address } = useAccount();
  const { presentContent } = useIntercom();

  const { data: markets } = useReadPreviewerExactly({
    address: previewerAddress,
    account: address,
    args: [address ?? zeroAddress],
  });

  return (
    <View display="flex" justifyContent="center" backgroundColor="$backgroundSoft" gap="$s4">
      <View display="flex" flexDirection="row" justifyContent="center" alignItems="center" gap="$s2">
        <Text emphasized subHeadline color="$uiNeutralSecondary" textAlign="center">
          {isCredit ? "Credit card limit" : "Debit card limit"}
        </Text>
        <Pressable
          onPress={() => {
            presentContent(isCredit ? "9467331" : "9922633").catch(handleError);
          }}
          hitSlop={ms(15)}
        >
          <Info size={16} color="$uiBrandSecondary" />
        </Pressable>
      </View>
      <View display="flex" justifyContent="center" alignItems="center">
        {isCredit ? (
          <Text
            sensitive
            textAlign="center"
            fontFamily="$mono"
            fontSize={ms(40)}
            emphasized
            overflow="hidden"
            maxFontSizeMultiplier={1}
          >
            {(markets ? Number(borrowLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
            })}
          </Text>
        ) : (
          <Text
            sensitive
            textAlign="center"
            fontFamily="$mono"
            fontSize={ms(40)}
            fontWeight="bold"
            overflow="hidden"
            maxFontSizeMultiplier={1}
          >
            {(markets ? Number(withdrawLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
            })}
          </Text>
        )}
      </View>
    </View>
  );
}
