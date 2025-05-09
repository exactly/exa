import { ScrollViewStyleReset } from "expo-router/html";
import React, { type ReactNode } from "react";

export default function HTML({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Exa App</title>
        <meta name="title" content="Exa App" />
        <meta name="description" content="Onchain banking, today" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Exa App" />
        <meta property="og:description" content="Onchain banking, today" />
        <meta property="og:image" content="https://exactly.app/og-image.webp" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <link rel="manifest" href="/manifest.json" />
        <ScrollViewStyleReset />
        <style>
          {`
          html, body {
            width: 100vw;
            height: 100dvh;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
          }
          @media (max-aspect-ratio: 10/16) {
            #root { width: 100vw; height: 100dvh; }
          }
          @media (min-aspect-ratio: 10/16) {
            #root {
              aspect-ratio: 10 / 16;
              width: min(100vw, calc(100dvh * 10 / 16));
              height: min(100dvh, calc(100vw * 16 / 10));
            }
          }
          @media (prefers-color-scheme: light) {
            html, body { background: white !important; }
            #root { background: white !important; }
          }
          @media (prefers-color-scheme: dark) {
            html, body { background: black !important; }
            #root { background: black !important; }
          }
      `}
        </style>
      </head>
      <body>{children}</body>
    </html>
  );
}
