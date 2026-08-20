import { extractExpoPathFromURL } from "expo-router/build/fork/extractPathFromURL";

import links from "@exactly/common/generated/links";

import queryClient from "../utils/queryClient";

// eslint-disable-next-line import/prefer-default-export -- expo router expects this named export
export function redirectSystemPath({ path }: { path: string }) {
  try {
    const target = `/${extractExpoPathFromURL([], path)}`;
    const route = `/${target.split(/[/?#]/)[1]}`;
    if (excluded.has(route)) return "/";
    if ((target.startsWith("/?") || links.includes(route)) && !queryClient.getQueryData(["credential"]))
      queryClient.setQueryData<string>(["deeplink"], (previous) => previous ?? target);
  } catch {} // eslint-disable-line no-empty -- untrusted third-party url
  return path;
}

const excluded = new Set(["/loan", "/roll-debt", "/send-funds", "/swaps"]);
