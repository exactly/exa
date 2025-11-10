import { Image } from "expo-image";
import { styled } from "tamagui";

export default styled(Image, {
  name: "AssetLogo",
  cachePolicy: "memory-disk",
  contentFit: "contain",
  transition: "smooth",
  placeholderContentFit: "cover",
  borderRadius: "$r_0",
});
