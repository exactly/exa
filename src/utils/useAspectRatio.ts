import { useWindowDimensions } from "react-native";

export default function useAspectRatio() {
  const { width, height } = useWindowDimensions();
  if (typeof window === "undefined") return 1;
  if (height <= 0 || width <= 0) return 9 / 16;
  return Math.min(width / height, 9 / 16);
}
