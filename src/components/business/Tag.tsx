import React from "react";

import Text from "../shared/Text";

export default function Tag({ label, variant }: { label: string; variant: "error" | "success" | "warning" }) {
  return (
    <Text
      pill
      caption2
      textTransform="uppercase"
      alignSelf="flex-start"
      color={colors[variant].color}
      backgroundColor={colors[variant].backgroundColor}
    >
      {label}
    </Text>
  );
}

const colors = {
  error: { color: "$interactiveOnBaseErrorDefault", backgroundColor: "$interactiveBaseErrorDefault" },
  success: { color: "$interactiveOnBaseSuccessDefault", backgroundColor: "$interactiveBaseSuccessDefault" },
  warning: { color: "$interactiveOnBaseWarningDefault", backgroundColor: "$interactiveBaseWarningDefault" },
} as const;
