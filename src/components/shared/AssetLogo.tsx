import { Image } from "expo-image";
import { styled } from "tamagui";

import reportError from "../../utils/reportError";

export default styled(Image, {
  name: "AssetLogo",
  cachePolicy: "memory-disk",
  contentFit: "contain",
  transition: "smooth",
  placeholderContentFit: "cover",
  borderRadius: "$r_0",
  onError: reportError,
});
