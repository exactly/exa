import domain from "@exactly/common/domain";
import { ScrollViewStyleReset } from "expo-router/html";
import React, { type ReactNode } from "react";

import appMetadata from "../../package.json";

export default function HTML({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Exa App</title>
        <meta name="title" content={appMetadata.title} />
        <meta name="description" content={appMetadata.description} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={appMetadata.title} />
        <meta property="og:description" content={appMetadata.description} />
        <meta property="og:image" content="https://exactly.app/og-image.webp" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="fc:miniapp"
          content={`{"version":"1","imageUrl":"https://exactly.app/miniapp-image.webp","button":{"title":"Get your card","action":{"type":"launch_miniapp","name":"${appMetadata.title}","url":"https://${domain}"}}}`}
        />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="stylesheet" href="/styles/aspect-ratio.css" />
        <link rel="stylesheet" href="/styles/layout.css" />
        <link rel="stylesheet" href="/styles/loader.css" />
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
          #root { visibility: hidden; }
        `,
          }}
        />
      </head>
      <body>
        <div id="app-loader">
          <div className="spinner" />
        </div>
        {children}
      </body>
    </html>
  );
}
