import { styled } from "tamagui";

import View from "./View";
const StatusIndicator = styled(View, {
  width: 12,
  height: 12,
  borderRadius: 100,
  backgroundColor: "$uiBrandPrimary",
  position: "absolute",
  right: -2,
  top: -2,
  borderWidth: 2,
  borderColor: "$borderBrandSoft",
  variants: {
    type: {
      online: { backgroundColor: "$uiBrandPrimary", borderColor: "$borderBrandSoft" },
      notification: { backgroundColor: "$uiInfoSecondary", borderColor: "$interactiveBaseInformationSoftDefault" },
    },
  },
  defaultVariants: { type: "online" },
  zIndex: 1,
});

export default StatusIndicator;
