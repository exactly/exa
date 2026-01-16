import type { ViewProps } from "tamagui";
import { styled, View } from "tamagui";

export type ViewProperties = ViewProps & {
  fullScreen?: boolean;
  padded?: boolean;
  smallPadding?: boolean;
  tab?: boolean;
};

export default styled(View, {
  variants: {
    fullScreen: { true: { width: "100%", height: "100%" } },
    padded: { true: { padding: "$s4" } },
    tab: { true: { paddingBottom: 0 } },
    smallPadding: { true: { padding: "$s3" } },
  },
});
