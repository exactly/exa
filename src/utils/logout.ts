import { disconnect } from "@wagmi/core";

import { logout as logoutIntercom } from "./intercom";
import { logout as logoutOnesignal } from "./onesignal";
import queryClient from "./queryClient";
import { reset as resetSegment } from "./segment";
import exaConfig from "./wagmi/exa";

export default async function logout() {
  await Promise.all([queryClient.cancelQueries(), logoutIntercom()]);
  logoutOnesignal();
  resetSegment();
  queryClient.getMutationCache().clear();
  queryClient.removeQueries({ queryKey: ["auth"] });
  await queryClient.resetQueries({ queryKey: ["credential"] });
  queryClient.unmount();
  await disconnect(exaConfig);
}
