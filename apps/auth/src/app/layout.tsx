import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { TRPCProvider } from "./trpc/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Asocialmedia Auth | User Management",
  description: "Asocialmedia Auth Service",
  icons: {
    icon: { url: "/favicon.svg", type: "image/svg+xml" },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
