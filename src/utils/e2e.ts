import { Platform } from "react-native";

import { useMutation } from "@tanstack/react-query";

const e2e = process.env.EXPO_PUBLIC_ENV === "e2e";
export default e2e;

export function useSubmitCoverage() {
  return useMutation({
    mutationFn: () =>
      e2e
        ? fetch(`http://localhost:3000/e2e/coverage?platform=${Platform.OS}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(__coverage__),
          })
        : Promise.resolve(null),
  });
}

declare const __coverage__: unknown;
