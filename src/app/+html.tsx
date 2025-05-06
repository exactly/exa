import { ScrollViewStyleReset } from "expo-router/html";
import React, { type ReactNode } from "react";

export default function HTML({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <link rel="manifest" href="/manifest.json" />
        <ScrollViewStyleReset />
        <style>{`
          html, body {
            display: flex;
            justify-content: center;
            align-items: center;
          }
          #root { aspect-ratio: 10 / 16; }
          @media (prefers-color-scheme: light) {
            html, body { background: #F7F9F8 }
            #root { background: #F7F9F8 }
          }
          @media (prefers-color-scheme: dark) {
            html, body { background: #101211 }
            #root { background: #101211 }
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
