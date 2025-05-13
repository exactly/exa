import { Platform, useWindowDimensions } from "react-native";

export default function useAspectRatio() {
  const { width, height } = useWindowDimensions();
  return Platform.OS === "web" ? Math.min(width / height, 9 / 16) : 1;
}
