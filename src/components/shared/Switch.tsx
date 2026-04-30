import { createStyledContext, styled, View, withStaticProperties } from "tamagui";

const SwitchContext = createStyledContext<{ checked: boolean }>({ checked: false });

const SwitchFrame = styled(View, {
  name: "Switch",
  context: SwitchContext,
  width: "$s8",
  height: "$s5",
  borderRadius: "$r_0",
  padding: "$s1",
  animation: "default",
  animateOnly: ["backgroundColor"],
  variants: {
    checked: {
      true: { backgroundColor: "$backgroundBrandMild" },
      false: { backgroundColor: "$backgroundStrong" },
    },
  } as const,
});

const SwitchThumb = styled(View, {
  name: "SwitchThumb",
  context: SwitchContext,
  width: "$s4_5",
  height: "$s4_5",
  borderRadius: "$r_0",
  animation: "default",
  animateOnly: ["transform", "backgroundColor"],
  variants: {
    checked: {
      true: { backgroundColor: "$backgroundBrand", x: "$s5" },
      false: { backgroundColor: "$backgroundSoft", x: 0 },
    },
  } as const,
});

export default withStaticProperties(SwitchFrame, { Thumb: SwitchThumb });
