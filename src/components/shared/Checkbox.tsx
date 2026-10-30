import React from "react";

import { style, styled, Checkbox as TamaguiCheckbox, withStaticProperties, type GetProps } from "tamagui";

const active = style({ backgroundColor: "backgroundBrand", borderColor: "backgroundBrand" });
const dangerActive = style({ backgroundColor: "uiErrorSecondary", borderColor: "borderErrorStrong" });

const CheckboxFrame = styled(TamaguiCheckbox, {
  pointerEvents: "none",
  width: "s4_5",
  height: "s4_5",
  padding: 0,
  alignItems: "center",
  justifyContent: "center",
  borderWidth: 1,
  borderRadius: "r2_5",
  borderColor: "backgroundBrand",
  variants: { danger: { true: { borderColor: "borderErrorStrong" } } } as const,
});

function Checkbox({ danger, ...properties }: GetProps<typeof CheckboxFrame>) {
  return <CheckboxFrame danger={danger} activeStyle={danger ? dangerActive : active} {...properties} />;
}

export default withStaticProperties(Checkbox, { Indicator: TamaguiCheckbox.Indicator });
