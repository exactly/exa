import { XCircle } from "@tamagui/lucide-icons";
import { router } from "expo-router";
import React from "react";
import { ScrollView } from "tamagui";

import Details from "./Details";
import Values from "./Values";
import type { WithdrawDetails } from "./Withdraw";
import queryClient from "../../utils/queryClient";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Failure({
  details: { assetName, amount, usdValue, isExternalAsset },
  hash,
}: {
  details: WithdrawDetails;
  hash?: string;
}) {
  return (
    <View>
      <ScrollView>
        <View borderBottomColor="$borderNeutralSoft" borderBottomWidth={1}>
          <View padded gap="$s5">
            <View gap="$s4" alignItems="center">
              <View
                backgroundColor="$interactiveBaseErrorSoftDefault"
                width={88}
                height={88}
                justifyContent="center"
                alignItems="center"
                borderRadius="$r_0"
                padding="$5"
              >
                <XCircle size={56} color="$interactiveOnBaseErrorSoft" />
              </View>
              <Text title3 color="$uiErrorSecondary">
                Transaction failed
              </Text>
            </View>
            <Values amount={amount} assetName={assetName} usdValue={usdValue} isExternalAsset={isExternalAsset} />
          </View>
        </View>
        <Details
          isExternalAsset={isExternalAsset}
          hash={hash}
          onClose={() => {
            queryClient.setQueryData(["withdrawal"], { receiver: undefined, market: undefined, amount: 0n });
            router.replace("/");
          }}
        />
      </ScrollView>
    </View>
  );
}
