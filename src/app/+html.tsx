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
            background: black !important;
          }
          #root { aspect-ratio: 10 / 16; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
