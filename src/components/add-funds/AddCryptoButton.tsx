import { useNavigation } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { View, XStack } from "tamagui";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import CubeWithCircles from "../../assets/images/cube-with-circles.svg";
import Optimism from "../../assets/images/optimism.svg";
import assetLogos from "../../utils/assetLogos";
import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";

// TODO remove limitation for next release
const supportedAssets = Object.entries(assetLogos)
  .filter(([symbol]) => symbol !== "USDC.e" && symbol !== "DAI")
  .map(([symbol, image]) => ({ symbol, image }));

export default function AddCryptoButton() {
  const navigation = useNavigation<AppNavigationProperties>();
  return (
    <Pressable
      onPress={() => {
        navigation.navigate("add-funds", { screen: "add-crypto" });
      }}
    >
      <View borderWidth={1} borderRadius="$r5" borderColor="$borderNeutralSoft" padding={16} gap={20}>
        <View gap={10} flexDirection="row" alignItems="center">
          <View
            width={50}
            height={50}
            borderRadius="$r3"
            backgroundColor="$interactiveBaseBrandSoftDefault"
            justifyContent="center"
            alignItems="center"
          >
            <CubeWithCircles width={24} height={24} color="$iconBrandDefault" />
          </View>
          <View gap={5}>
            <Text fontSize={17} fontWeight="bold">
              Cryptocurrency
            </Text>
            <Text fontSize={13} color="$uiNeutralSecondary">
              Multiple assets on OP Mainnet.
            </Text>
          </View>
        </View>
        <View gap="$s5" flexDirection="row" justifyContent="flex-start" alignItems="flex-start" width="100%">
          <View borderRadius="$r3" gap={5}>
            <Text fontSize={13} color="$uiNeutralSecondary" fontWeight="bold">
              Network
            </Text>
            <View>
              <Optimism width={24} height={24} color="$iconBrandDefault" />
            </View>
          </View>
          <View borderRadius="$r3" gap={5}>
            <Text fontSize={13} color="$uiNeutralSecondary" fontWeight="bold">
              Assets
            </Text>
            <XStack>
              {supportedAssets.map((asset, index) => {
                return (
                  <View key={asset.symbol} transform={[{ translateX: index * 10 * -0.5 }]}>
                    <AssetLogo uri={asset.image} width={24} height={24} />
                  </View>
                );
              })}
            </XStack>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
