import type { ThemeProviderProps } from "next-themes";
import localFont from "next/font/local";

import ReactQueryProvider from "./query";
import { ThemeProvider } from "./theme";
import { VerificationProvider } from "./verification";

export const SofiaProSoft = localFont({
  display: "swap",
  src: [
    { path: "../fonts/SofiaProSoftReg.woff2", style: "normal", weight: "400" },
    { path: "../fonts/SofiaProSoftMed.woff2", style: "normal", weight: "500" },
    { path: "../fonts/SofiaProSoftBold.woff2", style: "normal", weight: "700" },
  ],
  variable: "--font-sofia-pro-soft",
});

type DesignSystemProviderProperties = ThemeProviderProps;

export const DesignSystemProvider = ({
  children,
  ...properties
}: DesignSystemProviderProperties) => (
  <ReactQueryProvider>
    <ThemeProvider {...properties}>
      <VerificationProvider>{children}</VerificationProvider>
    </ThemeProvider>
  </ReactQueryProvider>
);
