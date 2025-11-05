// hooks/useOnrampProviders.ts
import domain from "@exactly/common/domain";
import { useQuery } from "@tanstack/react-query";

import { KYC_TEMPLATE_ID } from "../utils/persona";
import queryClient from "../utils/queryClient";
import { getKYCStatus, getOnrampProviders } from "../utils/server";

export default function useOnRampProviders() {
  return useQuery({
    queryKey: ["onramp", "providers"],
    queryFn: async () => {
      await getKYCStatus(KYC_TEMPLATE_ID, "true");
      const countryCode = queryClient.getQueryData<string>(["user", "country"]);
      return getOnrampProviders(KYC_TEMPLATE_ID, countryCode, `https://${domain}/add-funds/onramp-onboarding`);
    },
    staleTime: 300_000,
  });
}
