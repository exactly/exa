import React from "react";
import { useTranslation } from "react-i18next";
import { FadeIn, FadeOut } from "react-native-reanimated";

import { useRouter } from "expo-router";

import { ChevronRight } from "@tamagui/lucide-icons-2/icons/ChevronRight";

import usePendingOperations from "../../utils/usePendingOperations";
import AnimatedView from "../shared/AnimatedView";
import Text from "../shared/Text";

function ProposalBanner() {
  const { t } = useTranslation();
  const router = useRouter();
  const { count } = usePendingOperations();
  return count > 0 ? (
    <AnimatedView
      entering={FadeIn}
      exiting={FadeOut}
      backgroundColor="interactiveBaseInformationSoftDefault"
      display="flex"
      flexDirection="row"
      justifyContent="space-between"
      paddingVertical="s3"
      paddingHorizontal="s4"
      cursor="pointer"
      onPress={() => {
        router.push("/pending-proposals");
      }}
    >
      <Text emphasized footnote color="interactiveOnBaseInformationSoft">
        {t("Pending requests → {{count}}", { count })}
      </Text>
      <ChevronRight size={16} color="interactiveOnBaseInformationSoft" />
    </AnimatedView>
  ) : null;
}

export default ProposalBanner;
