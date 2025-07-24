import type { Credential } from "@exactly/common/validation";
import { useMutation } from "@tanstack/react-query";

import { createCredential, getCredential } from "./server";

export default function useAuthentication(
  onSuccess: (credential: Credential) => void,
  onError: (error: unknown) => void,
) {
  const { mutate: createAccount, isPending: isCreateAccountPending } = useMutation({
    mutationFn: createCredential,
    onSuccess,
    onError,
  });
  const { mutate: recoverAccount, isPending: isRecoverAccountPending } = useMutation({
    mutationFn: getCredential,
    onSuccess,
    onError,
  });
  return { createAccount, isCreateAccountPending, recoverAccount, isRecoverAccountPending };
}
