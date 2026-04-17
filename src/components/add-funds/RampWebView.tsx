import React, { useCallback, useRef } from "react";
import type { SyntheticEvent } from "react";
import { Platform } from "react-native";
import { WebView } from "react-native-webview";

export default function RampWebView({
  uri,
  redirectURL,
  onRedirect,
  onError,
}: {
  onError?: () => void;
  onRedirect: (url: string) => void;
  redirectURL: string;
  uri: string;
}) {
  const redirectedRef = useRef(false);
  const handleRedirect = useCallback(
    (url: string) => {
      if (redirectedRef.current) return;
      redirectedRef.current = true;
      onRedirect(url);
    },
    [onRedirect],
  );
  if (Platform.OS === "web") {
    return React.createElement("iframe", {
      src: uri,
      style: { flex: 1, border: "none", width: "100%", height: "100%" },
      onLoad: (event: SyntheticEvent<HTMLIFrameElement>) => {
        try {
          const url = event.currentTarget.contentWindow?.location.href;
          if (url?.startsWith(redirectURL)) handleRedirect(url);
        } catch {} // eslint-disable-line no-empty -- cross-origin expected
      },
    });
  }
  return (
    <WebView
      source={{ uri }}
      style={{ flex: 1 }}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url.startsWith(redirectURL)) {
          handleRedirect(request.url);
          return false;
        }
        return true;
      }}
      onError={onError}
      onHttpError={onError}
    />
  );
}
