import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import { AlertTriangle, ArrowLeft, Files, Share as ShareIcon } from "@tamagui/lucide-icons";
import { setStringAsync } from "expo-clipboard";
import { useNavigation } from "expo-router";
import React, { useCallback, useState } from "react";
import { PixelRatio, Pressable, Share } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";
import { useAccount } from "wagmi";

import SupportedAssetsSheet from "./SupportedAssetsSheet";
import type { AppNavigationProperties } from "../../app/(app)/_layout";
import OptimismImage from "../../assets/images/optimism.svg";
import assetLogos from "../../utils/assetLogos";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import AssetLogo from "../shared/AssetLogo";
import Button from "../shared/Button";
import CopyAddressSheet from "../shared/CopyAddressSheet";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

const supportedAssets = Object.entries(assetLogos)
  .filter(([symbol]) => symbol !== "USDC.e" && symbol !== "DAI")
  .map(([symbol, image]) => ({ symbol, image }));

export default function AddCrypto() {
  const navigation = useNavigation<AppNavigationProperties>();
  const fontScale = PixelRatio.getFontScale();
  const { presentArticle } = useIntercom();
  const { address } = useAccount();

  const [copyAddressShown, setCopyAddressShown] = useState(false);
  const [supportedAssetsShown, setSupportedAssetsShown] = useState(false);

  const copy = useCallback(() => {
    if (!address) return;
    setStringAsync(address).catch(reportError);
    setCopyAddressShown(true);
  }, [address]);

  const share = useCallback(async () => {
    if (!address) return;
    await Share.share({ message: address, title: `Share ${chain.name} address` });
  }, [address]);
  return (
    <SafeView fullScreen>
      <View gap="$s5" fullScreen padded>
        <View gap="$s5">
          <XStack gap="$s3" justifyContent="space-around" alignItems="center">
            <View position="absolute" left={0}>
              <Pressable
                onPress={() => {
                  if (navigation.canGoBack()) {
                    navigation.goBack();
                  } else {
                    navigation.replace("(home)", { screen: "index" });
                  }
                }}
              >
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
            </View>
            <View flexDirection="row" alignItems="center" alignSelf="center">
              <Text color="$uiNeutralSecondary" fontSize={15} fontWeight="bold">
                {`Add Funds / `}
              </Text>
              <Text fontSize={15} fontWeight="bold">
                Cryptocurrency
              </Text>
            </View>
          </XStack>
        </View>
        <ScrollView flex={1}>
          <YStack gap="$s5">
            <YStack flex={1} borderBottomWidth={1} borderBottomColor="$borderNeutralSoft" paddingBottom={20} gap="$s5">
              <Text fontSize={15} color="$uiNeutralSecondary" fontWeight="bold">
                Your {chain.name} address
              </Text>
              <Pressable hitSlop={15} onPress={copy}>
                {address && (
                  <Text fontFamily="$mono" fontSize={18} color="$uiNeutralPrimary">
                    {shortenHex(address, 10, 12)}
                  </Text>
                )}
              </Pressable>
              <XStack alignItems="center" gap="$s4">
                <Button
                  main
                  spaced
                  onPress={copy}
                  hitSlop={15}
                  iconAfter={<Files size={18 * fontScale} color="$interactiveOnBaseBrandDefault" />}
                  backgroundColor="$interactiveBaseBrandDefault"
                  color="$interactiveOnBaseBrandDefault"
                  contained
                  fullwidth
                  flex={1}
                >
                  <Text
                    fontSize={15}
                    emphasized
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    color="$interactiveOnBaseBrandDefault"
                  >
                    Copy
                  </Text>
                </Button>
                <Button
                  main
                  spaced
                  onPress={() => {
                    share().catch(reportError);
                  }}
                  hitSlop={15}
                  iconAfter={<ShareIcon size={18 * fontScale} color="$interactiveOnBaseBrandSoft" />}
                  backgroundColor="$interactiveBaseBrandSoftDefault"
                  color="$interactiveOnBaseBrandSoft"
                  outlined
                  fullwidth
                  flex={1}
                >
                  <Text
                    fontSize={15}
                    emphasized
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    color="$interactiveOnBaseBrandSoft"
                  >
                    Share
                  </Text>
                </Button>
              </XStack>
            </YStack>
            <CopyAddressSheet
              open={copyAddressShown}
              onClose={() => {
                setCopyAddressShown(false);
              }}
            />
            <SupportedAssetsSheet
              open={supportedAssetsShown}
              onClose={() => {
                setSupportedAssetsShown(false);
              }}
            />
            <XStack justifyContent="space-between" alignItems="center">
              <Text emphasized footnote color="$uiNeutralSecondary" textAlign="left">
                Network
              </Text>
              <Text emphasized footnote color="$uiNeutralSecondary" textAlign="right">
                Supported Assets
              </Text>
            </XStack>
            <XStack gap="$s5" justifyContent="space-between" alignItems="center">
              <XStack alignItems="center" gap="$s3" flex={1}>
                <OptimismImage height={32} width={32} />
                <Text emphasized primary headline>
                  {chain.name}
                </Text>
              </XStack>
              <XStack
                borderWidth={1}
                borderColor="$borderNeutralSoft"
                borderRadius="$r_0"
                padding="$s3_5"
                alignSelf="flex-end"
                cursor="pointer"
                onPress={() => {
                  setSupportedAssetsShown(true);
                }}
              >
                {supportedAssets.map((asset, index) => {
                  return (
                    <XStack key={index} marginRight={index < supportedAssets.length - 1 ? -12 : 0} zIndex={index}>
                      <AssetLogo uri={asset.image} width={32} height={32} />
                    </XStack>
                  );
                })}
              </XStack>
            </XStack>
          </YStack>
        </ScrollView>
        <XStack
          gap="$s4"
          alignItems="flex-start"
          borderTopWidth={1}
          borderTopColor="$borderNeutralSoft"
          paddingTop="$s3"
        >
          <View>
            <AlertTriangle size={16} width={16} height={16} color="$uiWarningSecondary" />
          </View>
          <XStack flex={1}>
            <Text emphasized caption2 color="$uiNeutralPlaceholder" textAlign="justify">
              Only send assets on {chain.name}. Sending funds from other networks may cause permanent loss.
              <Text
                cursor="pointer"
                emphasized
                caption2
                color="$uiBrandSecondary"
                onPress={() => {
                  presentArticle("8950801").catch(reportError);
                }}
              >
                &nbsp;Learn more about adding funds.
              </Text>
            </Text>
          </XStack>
        </XStack>
      </View>
    </SafeView>
  );
}
