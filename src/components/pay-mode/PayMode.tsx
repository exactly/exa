import React, { useRef } from "react";
import { Trans } from "react-i18next";
import { RefreshControl } from "react-native";

import { useRouter } from "expo-router";

import { ScrollView, XStack } from "tamagui";

import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";

import OverduePayments from "./OverduePayments";
import PaymentSheet from "./PaymentSheet";
import PaySelector from "./PaySelector";
import UpcomingPayments from "./UpcomingPayments";
import { presentCollection } from "../../utils/intercom";
import openBrowser from "../../utils/openBrowser";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useTabPress from "../../utils/useTabPress";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PayMode() {
  const { account } = useAsset(marketUSDCAddress);
  const router = useRouter();
  const { refetch, isPending } = useReadPreviewerExactly({
    address: previewerAddress,
    args: account ? [account] : undefined,
    query: { enabled: !!account },
  });

  const scrollRef = useRef<ScrollView>(null);
  const refresh = () => {
    if (account) refetch().catch(reportError);
    queryClient.refetchQueries({ queryKey: ["activity"] }).catch(reportError);
  };
  useTabPress("pay-mode", () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    refresh();
  });

  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor="$backgroundMild">
        <View position="absolute" top={0} left={0} right={0} height="50%" backgroundColor="$backgroundSoft" />
        <ScrollView
          ref={scrollRef}
          backgroundColor="transparent"
          contentContainerStyle={{ backgroundColor: "$backgroundMild" }}
          showsVerticalScrollIndicator={false}
          flex={1}
          refreshControl={<RefreshControl refreshing={isPending} onRefresh={refresh} />}
        >
          <>
            <PaySelector />
            <View padded gap="$s6">
              <OverduePayments onSelect={(m) => router.setParams({ maturity: String(m) })} />
              <UpcomingPayments onSelect={(m) => router.setParams({ maturity: String(m) })} />
              <XStack gap="$s4" alignItems="flex-start" paddingTop="$s3" flexWrap="wrap">
                <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
                  <Trans
                    i18nKey="Onchain credit is powered by <protocol>Exactly Protocol</protocol> and is subject to separate <terms>Terms and conditions</terms>. The Exa App does not issue or guarantee any funding."
                    components={{
                      protocol: (
                        <Text
                          cursor="pointer"
                          caption2
                          color="$interactiveOnDisabled"
                          textDecorationLine="underline"
                          onPress={() => {
                            openBrowser("https://exact.ly/").catch(reportError);
                          }}
                        />
                      ),
                      terms: (
                        <Text
                          cursor="pointer"
                          caption2
                          color="$interactiveOnDisabled"
                          textDecorationLine="underline"
                          onPress={() => {
                            presentCollection("10544608").catch(reportError);
                          }}
                        />
                      ),
                    }}
                  />
                </Text>
              </XStack>
            </View>
            <PaymentSheet />
          </>
        </ScrollView>
      </View>
    </SafeView>
  );
}
