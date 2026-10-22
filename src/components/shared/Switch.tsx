import { createStyledContext, styled, View, withStaticProperties } from "tamagui";

const SwitchContext = createStyledContext<{ checked: boolean }>({ checked: false });

const SwitchFrame = styled(View, {
  name: "Switch",
  context: SwitchContext,
  "aria-hidden": true,
  width: "$space.s8",
  height: "$space.s5",
  borderRadius: "$r_0",
  padding: "$s1",
  transition: "default",
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
  width: "$space.s4_5",
  height: "$space.s4_5",
  borderRadius: "$r_0",
  transition: "default",
  animateOnly: ["transform", "backgroundColor"],
  variants: {
    checked: {
      true: { backgroundColor: "$backgroundBrand", x: "$s5" },
      false: { backgroundColor: "$backgroundSoft", x: 0 },
    },
  } as const,
});

export default withStaticProperties(SwitchFrame, { Thumb: SwitchThumb });
