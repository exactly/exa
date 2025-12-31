import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import { AlertTriangle, ArrowLeft, Files, Share as ShareIcon } from "@tamagui/lucide-icons";
import { setStringAsync } from "expo-clipboard";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { PixelRatio, Pressable, Share } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";

import SupportedAssetsSheet from "./SupportedAssetsSheet";
import OptimismImage from "../../assets/images/optimism.svg";
import assetLogos from "../../utils/assetLogos";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import AssetLogo from "../shared/AssetLogo";
import CopyAddressSheet from "../shared/CopyAddressSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

const supportedAssets = Object.entries(assetLogos)
  .filter(([symbol]) => symbol !== "USDC.e" && symbol !== "DAI")
  .map(([symbol, image]) => ({ symbol, image }));

export default function AddCrypto() {
  const router = useRouter();
  const fontScale = PixelRatio.getFontScale();
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
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace("/(main)/(home)");
                  }
                }}
              >
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
            </View>
            <View flexDirection="row" alignItems="center" alignSelf="center">
              <Text emphasized subHeadline primary>
                Add Funds
              </Text>
            </View>
          </XStack>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} flex={1}>
          <YStack gap="$s5">
            <YStack flex={1} borderBottomWidth={1} borderBottomColor="$borderNeutralSoft" paddingBottom={20} gap="$s5">
              <Text emphasized subHeadline secondary>
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
                <Button primary flex={1} onPress={copy}>
                  <Button.Text>Copy</Button.Text>
                  <Button.Icon>
                    <Files size={18 * fontScale} />
                  </Button.Icon>
                </Button>
                <Button
                  secondary
                  flex={1}
                  onPress={() => {
                    share().catch(reportError);
                  }}
                >
                  <Button.Text>Share</Button.Text>
                  <Button.Icon>
                    <ShareIcon size={18 * fontScale} />
                  </Button.Icon>
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
                {supportedAssets.map(({ symbol, image }, index) => {
                  return (
                    <XStack key={symbol} marginRight={index < supportedAssets.length - 1 ? -12 : 0} zIndex={index}>
                      <AssetLogo source={{ uri: image }} width={32} height={32} />
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
