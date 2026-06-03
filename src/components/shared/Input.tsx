import { Input, styled } from "tamagui";

export default styled(Input, {
  // @ts-expect-error valid runtime style narrowed out of input's v2 prop types
  fontVariant: ["stylistic-one", "stylistic-two", "stylistic-three"],
  fontSize: 15,
  padding: "$s3",
  borderColor: "$borderBrandStrong",
  color: "$uiNeutralPrimary",
  borderRadius: "$r3",
  placeholderTextColor: "$uiNeutralSecondary",
  focusStyle: { borderColor: "$borderBrandStrong" },
  focusVisibleStyle: { outlineWidth: 0, borderColor: "$borderBrandStrong", outlineColor: "$borderBrandStrong" },
});
