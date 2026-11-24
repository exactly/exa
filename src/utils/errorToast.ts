import { toast } from "@tamagui/toast";

import { onlineManager } from "@tanstack/react-query";

import { classifyError } from "./reportError";

export default function errorToast(error: unknown, title: string, options?: Parameters<typeof toast.error>[1]) {
  if (classifyError(error).network === undefined || onlineManager.isOnline()) toast.error(title, options);
}
