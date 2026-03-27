import { Button, styled } from "tamagui";

export default styled(Button, {
  minHeight: "auto",
  fontWeight: "bold",
  flexBasis: "auto",
  defaultVariants: { contained: true },
  borderWidth: 0,
  borderColor: "transparent",
  fontSize: 15,
  padding: "$s3",
  variants: {
    contained: {
      true: {
        backgroundColor: "$interactiveBaseBrandDefault",
        color: "$interactiveOnBaseBrandDefault",
        hoverStyle: { backgroundColor: "$interactiveBaseBrandHover" },
        pressStyle: { backgroundColor: "$interactiveBaseBrandPressed" },
      },
    },
    disabled: {
      true: { backgroundColor: "$interactiveDisabled", color: "$interactiveOnDisabled" },
    },
    danger: {
      true: {
        backgroundColor: "$interactiveBaseErrorSoftDefault",
        color: "$interactiveOnBaseErrorSoft",
        hoverStyle: { backgroundColor: "$interactiveBaseErrorSoftHover" },
        pressStyle: { backgroundColor: "$interactiveBaseErrorSoftPressed", color: "$interactiveOnBaseErrorSoft" },
      },
    },
    dangerSecondary: {
      true: {
        backgroundColor: "$interactiveBaseErrorDefault",
        color: "$interactiveOnBaseErrorDefault",
        hoverStyle: { backgroundColor: "$interactiveBaseErrorHover" },
        pressStyle: { backgroundColor: "$interactiveBaseErrorPressed" },
      },
    },
    main: {
      true: {
        fontSize: 15,
        fontWeight: "bold",
        height: 64,
        padding: "$s4_5",
        borderRadius: "$r3",
        scaleIcon: 1.5,
      },
    },
    spaced: { true: { spaceFlex: true, alignItems: "center" } },
    fullwidth: { true: { width: "100%" } },
    halfWidth: { true: { flexBasis: "50%" } },
  } as const,
});
