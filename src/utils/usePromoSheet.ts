import { useQuery } from "@tanstack/react-query";

import { isPromoActive, PROMO } from "./promo";
import queryClient from "./queryClient";

export default function usePromoSheet() {
  const { data: seen } = useQuery<boolean>({ queryKey: ["settings", "promo-seen", PROMO.id] });
  return {
    visible: isPromoActive() && !seen,
    dismiss: () => {
      queryClient.setQueryData(["settings", "promo-seen", PROMO.id], true);
    },
  };
}
