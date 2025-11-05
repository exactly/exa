import React, { useState } from "react";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { Spinner, XStack, YStack } from "tamagui";

import type { OnRampProvider } from "../../utils/server";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";

export default function LinkSheet({
  open,
  onClose,
  provider,
  uri,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  provider: OnRampProvider;
  uri: string;
  onSuccess: (signedAgreementId?: string) => void | Promise<void>;
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const handleNavigationStateChange = async (navState: WebViewNavigation) => {
    if (provider === "bridge") {
      const url = new URL(navState.url);
      const signedAgreementId = url.searchParams.get("signed_agreement_id");

      if (signedAgreementId) {
        setIsProcessing(true);
        await onSuccess(signedAgreementId);
        onClose();
      }
    }
    if (provider === "manteca") {
      const url = new URL(navState.url);
      if (url.pathname.includes("onramp-onboarding")) {
        setIsProcessing(true);
        await onSuccess();
        onClose();
      }
    }
  };

  return (
    <ModalSheet open={open} onClose={onClose} disableDrag heightPercent={80}>
      <SafeView
        flex={1}
        position="relative"
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
        paddingHorizontal="$s5"
        $platform-web={{ paddingVertical: "$s7" }}
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <XStack flex={1}>
          <WebView
            source={{ uri }}
            renderLoading={LoadingIndicator}
            startInLoadingState
            onNavigationStateChange={handleNavigationStateChange}
          />
        </XStack>
        {isProcessing && <LoadingIndicator />}
      </SafeView>
    </ModalSheet>
  );
}

function LoadingIndicator() {
  return (
    <YStack
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      alignItems="center"
      justifyContent="center"
      zIndex={3}
      backgroundColor="$backgroundSoft"
    >
      <Spinner color="$interactiveBaseBrandDefault" />
    </YStack>
  );
}
