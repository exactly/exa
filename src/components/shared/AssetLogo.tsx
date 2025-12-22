import { Image } from "expo-image";
import { Platform } from "react-native";
import { styled } from "tamagui";

import reportError from "../../utils/reportError";

export default styled(Image, {
  name: "AssetLogo",
  cachePolicy: "memory-disk",
  contentFit: "contain",
  transition: Platform.OS === "web" ? "smooth" : undefined,
  placeholderContentFit: "cover",
  borderRadius: "$r_0",
  onError: reportError,
});
