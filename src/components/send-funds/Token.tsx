import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, Coins } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";

import { lifiChainsOptions, lifiTokensOptions } from "../../utils/lifi";
import AddFundsOption from "../add-funds/AddFundsOption";
import AssetLogo from "../shared/AssetLogo";
import IconButton from "../shared/IconButton";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Token() {
  const router = useRouter();
  const { t } = useTranslation();
  const { asset: assetParameter, toChain } = useLocalSearchParams();
  const asset = typeof assetParameter === "string" ? assetParameter : "";
  const destination = typeof toChain === "string" ? Number(toChain) : chain.id;
  const [search, setSearch] = useState("");
  const { data: chains } = useQuery(lifiChainsOptions);
  const { data: tokens, isPending } = useQuery(lifiTokensOptions);
  const destinationChain = chains?.find((item) => item.id === destination);

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (tokens ?? [])
      .filter((token) => token.chainId === (destination as typeof token.chainId))
      .filter(
        (token) => !query || token.symbol.toLowerCase().includes(query) || token.address.toLowerCase().includes(query),
      )
      .slice(0, 20);
  }, [tokens, destination, search]);

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
              else router.replace("/send-funds/destination");
            }}
          />
          <Text emphasized subHeadline primary>
            {destinationChain?.name ?? t("Choose asset")}
          </Text>
          <View width={40} />
        </XStack>
        <Input
          placeholder={t("Search tokens")}
          value={search}
          onChangeText={setSearch}
          backgroundColor="$backgroundSoft"
          borderColor="$uiNeutralTertiary"
          borderWidth={1}
        />
        <ScrollView flex={1} showsVerticalScrollIndicator={false}>
          <YStack flex={1} gap="$s3_5">
            {isPending && <Skeleton width="100%" height={82} />}
            {matches.map((token) => (
              <AddFundsOption
                key={`${token.chainId}-${token.address}`}
                icon={<AssetLogo uri={token.logoURI} symbol={token.symbol} width={24} height={24} />}
                title={token.symbol}
                subtitle={token.name}
                onPress={() => {
                  router.push({
                    pathname: "/send-funds/receiver",
                    params: { asset, toChain: String(destination), toToken: token.address },
                  });
                }}
              />
            ))}
            {!isPending && matches.length === 0 && search.trim() && (
              <AddFundsOption
                icon={<Coins size={24} color="$iconBrandDefault" />}
                title={search.trim()}
                subtitle={t("Use this address")}
                onPress={() => {
                  router.push({
                    pathname: "/send-funds/receiver",
                    params: { asset, toChain: String(destination), toToken: search.trim() },
                  });
                }}
              />
            )}
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}
