import { styled, Checkbox as TamaguiCheckbox, withStaticProperties } from "tamagui";

const CheckboxFrame = styled(TamaguiCheckbox, {
  pointerEvents: "none",
  borderColor: "$backgroundBrand",
  activeStyle: { backgroundColor: "$backgroundBrand", borderColor: "$backgroundBrand" },
  variants: {
    danger: {
      true: {
        borderColor: "$borderErrorStrong",
        activeStyle: { backgroundColor: "$uiErrorSecondary", borderColor: "$borderErrorStrong" },
      },
    },
  } as const,
});

export default withStaticProperties(CheckboxFrame, { Indicator: TamaguiCheckbox.Indicator });
