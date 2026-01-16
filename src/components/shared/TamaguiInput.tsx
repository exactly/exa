import type { ReactNode } from "react";

import { styled, withStaticProperties } from "tamagui";

import Input from "./Input";
import View from "./View";

const InputFrame = styled(View, {
  borderWidth: 1,
  borderRadius: "$r2",
  borderColor: "$borderNeutralMild",
  focusStyle: { borderColor: "$borderBrandStrong" },
  focusVisibleStyle: { outlineWidth: 0, borderColor: "$borderBrandStrong", outlineColor: "$borderBrandStrong" },
  flexDirection: "row",
  gap: "$s2",
  alignItems: "center",
  padding: "$s3",
});
const InputComponent = styled(Input, { flex: 1, padding: 0, unstyled: true });
function InputIcon({ children }: { children: ReactNode }) {
  return children;
}
export default withStaticProperties(InputFrame, { Icon: InputIcon, Input: InputComponent });
