import { exaPreviewerAddress } from "@exactly/common/generated/chain";
import { ChevronRight } from "@tamagui/lucide-icons";
import { useNavigation } from "expo-router";
import React from "react";
import { zeroAddress } from "viem";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import { useReadExaPreviewerPendingProposals } from "../../generated/contracts";
import useAccount from "../../utils/useAccount";
import Text from "../shared/Text";
import View from "../shared/View";

function ProposalBanner() {
  const navigation = useNavigation<AppNavigationProperties>();
  const { address } = useAccount();
  const {
    data: pendingProposals,
    isLoading,
    isFetching,
  } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: [address ?? zeroAddress],
    query: { enabled: !!address, gcTime: 0, refetchInterval: 30_000 },
  });
  if (isLoading || !pendingProposals || pendingProposals.length === 0) {
    return null;
  }
  return (
    pendingProposals.length > 0 && (
      <View
        backgroundColor="$interactiveBaseInformationSoftDefault"
        display="flex"
        flexDirection="row"
        justifyContent="space-between"
        paddingVertical="$s3"
        paddingHorizontal="$s4"
        disabled={isFetching}
        cursor="pointer"
        onPress={() => {
          navigation.navigate("pending-proposals/index");
        }}
      >
        <Text
          emphasized
          footnote
          color="$interactiveOnBaseInformationSoft"
        >{`Pending requests → ${pendingProposals.length}`}</Text>
        <ChevronRight size={16} color="$interactiveOnBaseInformationSoft" />
      </View>
    )
  );
}

export default ProposalBanner;
