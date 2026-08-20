import domain from "@exactly/common/domain";
import links from "@exactly/common/links";

import queryClient from "../utils/queryClient";
import reportError from "../utils/reportError";

// eslint-disable-next-line import/prefer-default-export -- expo router expects this named export
export function redirectSystemPath({ path }: { path: string }) {
  try {
    const url = /^[a-z][\d+.a-z-]*:/i.test(path) ? new URL(path) : undefined;
    const target = url ? `${url.host && url.host !== domain ? `/${url.host}` : ""}${url.pathname}${url.search}` : path;
    if (target.startsWith("/") && links.includes(`/${target.split(/[/?#]/)[1]}`))
      queryClient.setQueryData(["deeplink"], target);
  } catch (error) {
    reportError(error);
  }
  return path;
}
