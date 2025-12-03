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
        <meta property="og:image" content="https://assets.exactly.app/og-image.webp" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="fc:miniapp"
          content={`{"version":"1","imageUrl":"https://assets.exactly.app/miniapp-image.webp","button":{"title":"Get your card","action":{"type":"launch_miniapp","name":"${appMetadata.title}","url":"https://${domain}"}}}`}
        />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="color-scheme" content="light dark" />
        <link rel="manifest" href="/manifest.json" />
        <ScrollViewStyleReset />
        <style>
          {css`
            /* #region variables */
            :root {
              color-scheme: light dark;
              --loader-background: #fbfdfc;
              --loader-track: rgba(18, 165, 148, 0.25);
              --loader-active: #12a594;
            }

            @media (prefers-color-scheme: dark) {
              :root {
                --loader-background: #171918;
                --loader-track: rgba(87, 246, 225, 0.2);
                --loader-active: #57f6e1;
              }
            }
            /* #endregion */

            /* #region layout */
            html,
            body {
              width: 100vw;
              height: 100dvh;
              margin: 0;
              padding: 0;
              display: flex;
              justify-content: center;
              align-items: center;
              background: black !important;
            }

            #root {
              background: black !important;
              visibility: hidden;
            }

            .sheet-portal {
              position: fixed;
              inset: 0;
              display: grid;
              place-items: end center;
              pointer-events: none;
              justify-self: center;
            }
            /* #endregion */

            /* #region aspect ratio */
            @media (hover: none) and (pointer: coarse) {
              #root {
                width: 100vw;
                height: 100dvh;
                aspect-ratio: auto;
              }
              .sheet-portal {
                width: 100vw;
                height: 100dvh;
              }
            }

            @media (hover: none) and (pointer: coarse) and (min-width: 768px) {
              #root,
              .sheet-portal {
                aspect-ratio: 9 / 16;
                width: min(100vw, calc(100dvh * 9 / 16));
                height: min(100dvh, calc(100vw * 16 / 9));
              }
            }

            @media (pointer: fine) and (min-aspect-ratio: 9/16) {
              #root,
              .sheet-portal {
                aspect-ratio: 9 / 16;
                width: min(100vw, calc(100dvh * 9 / 16));
                height: min(100dvh, calc(100vw * 16 / 9));
              }
            }

            @media (pointer: fine) and (max-aspect-ratio: 9/16) {
              #root,
              .sheet-portal {
                width: 100vw;
                height: 100dvh;
              }
            }
            /* #endregion */

            /* #region loader */
            #app-loader {
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              display: flex;
              justify-content: center;
              align-items: center;
              background-color: var(--loader-background);
              z-index: 9999;
            }

            .spinner {
              width: 50px;
              height: 50px;
              border: 5px solid var(--loader-track);
              border-top-color: var(--loader-active);
              border-radius: 50%;
              animation: spin 1s linear infinite;
            }

            @keyframes spin {
              0% {
                transform: rotate(0deg);
              }
              100% {
                transform: rotate(360deg);
              }
            }
            /* #endregion */
          `}
        </style>
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

const css = String.raw;
