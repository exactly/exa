import { useCallback, useRef } from "react";

import { useMutation, type DefaultError, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";

export default function useSingleMutation<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TContext = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const mutation = useMutation(options);
  const { mutateAsync: run } = mutation;
  const pendingRef = useRef<Promise<TData>>(undefined);
  const mutateAsync = useCallback<typeof run>(
    (variables, callbacks) =>
      (pendingRef.current ??= run(variables, callbacks).finally(() => {
        pendingRef.current = undefined;
      })),
    [run],
  );
  const mutate = useCallback<UseMutationResult<TData, TError, TVariables, TContext>["mutate"]>(
    (variables, callbacks) => {
      mutateAsync(variables, callbacks).catch(() => undefined);
    },
    [mutateAsync],
  );
  return { ...mutation, mutate, mutateAsync };
}
