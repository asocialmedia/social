import { SofiaProSoft } from "@asm/ui";
import type { Metadata } from "next";
import { Head } from "nextra/components";
import "nextra-theme-docs/style.css";
import "./styles.css";
import NextraTheme from "./_components/nextra-theme";

export const metadata: Metadata = {
  title: "Asocialmedia Docs",
  description:
    "Documentation for Asocialmedia for developers to get started.",
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
    <html
      className={`${SofiaProSoft.className} ${SofiaProSoft.variable} antialiased`}
      dir="ltr"
      lang="en"
      suppressHydrationWarning
    >
      <Head>
        <meta content="width=device-width, initial-scale=1" name="viewport" />
      </Head>
      <body>
        <NextraTheme>{children}</NextraTheme>
      </body>
    </html>
  );
}
