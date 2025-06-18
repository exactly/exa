import type { Token } from "@lifi/sdk";
import { Search } from "@tamagui/lucide-icons";
import { Skeleton } from "moti/skeleton";
import React, { useState, useMemo } from "react";
import { Appearance, FlatList, Image, Platform, Pressable } from "react-native";
import { XStack, YStack, Sheet, ButtonIcon } from "tamagui";

import useAspectRatio from "../../utils/useAspectRatio";
import Button from "../shared/Button";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

interface TokenSelectModalProperties {
  open: boolean;
  tokens: Token[];
  selectedToken?: Token | null;
  onSelect: (token: Token) => void;
  onClose: () => void;
  isLoading?: boolean;
  title?: string;
}

interface TokenListItemProperties {
  token: Token;
  isSelected: boolean;
  onPress: () => void;
}

function TokenListItem({ token, isSelected, onPress }: TokenListItemProperties) {
  return (
    <Pressable onPress={onPress}>
      <XStack
        padding="$s4"
        alignItems="center"
        gap="$s3_5"
        backgroundColor={isSelected ? "$interactiveBaseBrandSoftDefault" : "transparent"}
        borderRadius="$r3"
      >
        <Image
          source={{
            uri: token.logoURI ?? "https://via.placeholder.com/40",
          }}
          width={40}
          height={40}
          borderRadius={20}
        />
        <YStack flex={1}>
          <Text emphasized subHeadline>
            {token.symbol}
          </Text>
          <Text footnote color="$uiNeutralSecondary" numberOfLines={1}>
            {token.name}
          </Text>
        </YStack>
      </XStack>
    </Pressable>
  );
}

function TokenSkeletonItem() {
  return (
    <XStack padding="$s4" alignItems="center" gap="$s3_5">
      <Skeleton radius="round" colorMode={Appearance.getColorScheme() ?? "light"} height={40} width={40} />

      <YStack flex={1} gap="$s2">
        <Skeleton colorMode={Appearance.getColorScheme() ?? "light"} height={16} width={60} />
        <Skeleton colorMode={Appearance.getColorScheme() ?? "light"} height={12} width={120} />
      </YStack>
    </XStack>
  );
}

export default function TokenSelectModal({
  open,
  tokens,
  selectedToken,
  onSelect,
  onClose,
  isLoading = false,
  title = "Select Token",
}: TokenSelectModalProperties) {
  const [searchQuery, setSearchQuery] = useState("");
  const aspectRatio = useAspectRatio();

  const filteredTokens = useMemo(() => {
    if (!searchQuery.trim()) return tokens;

    const query = searchQuery.toLowerCase().trim();
    return tokens.filter(
      (token) => token.symbol.toLowerCase().includes(query) || token.address.toLowerCase().includes(query),
    );
  }, [tokens, searchQuery]);

  const handleTokenSelect = (token: Token) => {
    onSelect(token);
    setSearchQuery("");
  };

  const renderTokenItem = ({ item }: { item: Token }) => (
    <TokenListItem
      token={item}
      isSelected={selectedToken?.address === item.address}
      onPress={() => {
        handleTokenSelect(item);
      }}
    />
  );

  const renderSkeletonItems = () => (
    <YStack>
      {Array.from({ length: 8 }).map((_, index) => (
        <TokenSkeletonItem key={index} />
      ))}
    </YStack>
  );

  return (
    <Sheet
      open={open}
      dismissOnSnapToBottom
      unmountChildrenWhenHidden
      forceRemoveScrollEnabled={open}
      animation="moderate"
      dismissOnOverlayPress
      onOpenChange={onClose}
      snapPoints={[85]}
      snapPointsMode="percent"
      disableDrag
      zIndex={100_000}
      modal
      portalProps={Platform.OS === "web" ? { style: { aspectRatio, justifySelf: "center" } } : undefined}
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
      />
      <Sheet.Frame>
        <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
          <View padded paddingTop="$s6" fullScreen flex={1}>
            {/* Header */}
            <View paddingBottom="$s4">
              <Text fontSize={20} fontWeight="bold" textAlign="center">
                {title}
              </Text>
            </View>

            {/* Search Input */}
            <View paddingBottom="$s4" flexDirection="row">
              <Input
                neutral
                flex={1}
                placeholder="Search by token name or address"
                placeholderTextColor="$interactiveTextDisabled"
                borderColor="$uiNeutralTertiary"
                borderRightColor="transparent"
                borderTopRightRadius={0}
                borderBottomRightRadius={0}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              <Button
                outlined
                borderColor="$uiNeutralTertiary"
                borderTopLeftRadius={0}
                borderBottomLeftRadius={0}
                borderLeftWidth={0}
              >
                <ButtonIcon>
                  <Search size={24} color="$interactiveOnBaseBrandSoft" />
                </ButtonIcon>
              </Button>
            </View>

            <View flex={1}>
              {isLoading ? (
                renderSkeletonItems()
              ) : (
                <FlatList
                  data={filteredTokens}
                  renderItem={renderTokenItem}
                  keyExtractor={(item) => item.address}
                  showsVerticalScrollIndicator={false}
                  ItemSeparatorComponent={() => <View height={1} />}
                  ListEmptyComponent={() => (
                    <View padding="$s6" alignItems="center">
                      <Text subHeadline color="$uiNeutralSecondary">
                        {searchQuery ? "No tokens found" : "No tokens available"}
                      </Text>
                    </View>
                  )}
                />
              )}
            </View>
          </View>
        </SafeView>
      </Sheet.Frame>
    </Sheet>
  );
}
