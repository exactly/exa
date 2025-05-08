import { Platform, Dimensions } from "react-native";

export default Platform.OS === "web"
  ? Math.min(Dimensions.get("window").width / Dimensions.get("window").height, 10 / 16)
  : 1;
