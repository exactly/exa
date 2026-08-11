import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";

import { destinationsOptions, lifiChainsOptions } from "../../utils/lifi";
import AddFundsOption from "../add-funds/AddFundsOption";
import AssetLogo from "../shared/AssetLogo";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Destination() {
  const router = useRouter();
  const { t } = useTranslation();
  const { asset: assetParameter } = useLocalSearchParams();
  const asset = typeof assetParameter === "string" ? assetParameter : "";
  const { data: chains, isPending } = useQuery(lifiChainsOptions);
  const { data: destinations } = useQuery(destinationsOptions);

  const supported = useMemo(
    () =>
      (chains ?? [])
        .filter((item) => destinations?.includes(item.id))
        .sort((a, b) => {
          if (a.id === chain.id) return -1;
          if (b.id === chain.id) return 1;
          return a.name.localeCompare(b.name);
        }),
    [chains, destinations],
  );

  if (!asset) return <Redirect href="/send-funds/asset" />;

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap="$s6" fullScreen padded>
        <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/send-funds/asset");
            }}
          />
          <Text emphasized subHeadline primary>
            {t("Select network")}
          </Text>
          <View width={40} />
        </XStack>
        <ScrollView flex={1} showsVerticalScrollIndicator={false}>
          <YStack flex={1} gap="$s3_5">
            {isPending && <Skeleton width="100%" height={82} />}
            {supported.map((item) => (
              <AddFundsOption
                key={item.id}
                icon={<AssetLogo uri={item.logoURI} width={24} height={24} />}
                title={item.name}
                subtitle={item.id === chain.id ? t("Same network") : item.chainType}
                onPress={() => {
                  router.push({ pathname: "/send-funds/token", params: { asset, toChain: String(item.id) } });
                }}
              />
            ))}
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}
