import { Input, styled } from "tamagui";

export default styled(Input, {
  style: { fontSize: 15 },
  padding: "$s3",
  borderColor: "$borderBrandStrong",
  color: "$uiNeutralPrimary",
  borderRadius: "$r3",
  placeholderTextColor: "$uiNeutralSecondary",
  focusStyle: { borderColor: "$borderBrandStrong" },
  focusVisibleStyle: { outlineWidth: 0, borderColor: "$borderBrandStrong", outlineColor: "$borderBrandStrong" },
});
