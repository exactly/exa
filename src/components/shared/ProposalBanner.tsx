import { ChevronRight } from "@tamagui/lucide-icons";
import { useRouter } from "expo-router";
import React from "react";

import usePendingOperations from "../../utils/usePendingOperations";
import Text from "../shared/Text";
import View from "../shared/View";

function ProposalBanner() {
  const router = useRouter();
  const { count } = usePendingOperations();
  return count > 0 ? (
    <View
      backgroundColor="$interactiveBaseInformationSoftDefault"
      display="flex"
      flexDirection="row"
      justifyContent="space-between"
      paddingVertical="$s3"
      paddingHorizontal="$s4"
      cursor="pointer"
      onPress={() => {
        router.push("/pending-proposals");
      }}
    >
      <Text emphasized footnote color="$interactiveOnBaseInformationSoft">{`Pending requests → ${count}`}</Text>
      <ChevronRight size={16} color="$interactiveOnBaseInformationSoft" />
    </View>
  ) : null;
}

export default ProposalBanner;
