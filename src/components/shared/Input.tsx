import { Input, styled } from "tamagui";

export default styled(Input, {
  // @ts-expect-error tamagui 3 types font variants as an impossible string and array intersection
  fontVariant: ["stylistic-one", "stylistic-two", "stylistic-three"],
  fontSize: 15,
  lineHeight: "web:4",
  letterSpacing: "4",
  height: "4",
  padding: "s3",
  borderColor: "borderBrandStrong hover:borderBrandStrong focus:borderBrandStrong focus-visible:borderBrandStrong",
  color: "uiNeutralPrimary",
  borderRadius: "r3",
  placeholderTextColor: "uiNeutralSecondary",
  outlineWidth: "focus-visible:0px",
  outlineColor: "focus-visible:borderBrandStrong",
});
