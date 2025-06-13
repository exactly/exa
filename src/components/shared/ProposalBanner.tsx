import { exaPreviewerAddress } from "@exactly/common/generated/chain";
import { ChevronRight } from "@tamagui/lucide-icons";
import { router } from "expo-router";
import React from "react";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import { useReadExaPreviewerPendingProposals } from "../../generated/contracts";
import Text from "../shared/Text";
import View from "../shared/View";

const ProposalBanner = () => {
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
          router.push("/pending-proposals");
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
};

export default ProposalBanner;
