import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DesignSystemProvider, SofiaProSoft } from "@asm/ui";
import { colors } from "@asm/ui/meta/colors";
import { siteConfig } from "@asm/ui/meta/site";
import type { ReactNode } from "react";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: colors.light.primary },
    { media: "(prefers-color-scheme: dark)", color: colors.dark.primary },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: siteConfig.keywords,
  authors: [...siteConfig.authors],
  creator: siteConfig.creator,
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
    creator: "Harsh Sahu | parazeeknova",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon/favicon.ico" },
      { url: "/favicon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      {
        url: "/favicon/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    other: [
      {
        rel: "mask-icon",
        url: "/favicon/maskable_icon.png",
        color: colors.light.primary,
      },
    ],
  },
  manifest: "site.webmanifest",
  verification: {
    me: ["https://przknv.cc"],
  },
};

interface RootLayoutProperties {
  readonly children: ReactNode;
}

const RootLayout = ({ children }: RootLayoutProperties) => (
  <html
    className={`${SofiaProSoft.className} ${SofiaProSoft.variable} antialiased`}
    data-scroll-behavior="smooth"
    lang="en"
    suppressHydrationWarning
  >
    <head>
      <link
        href="/favicon/favicon-16x16.png"
        rel="icon"
        sizes="16x16"
        type="image/png"
      />
      <link
        href="/favicon/favicon-32x32.png"
        rel="icon"
        sizes="32x32"
        type="image/png"
      />
      <link
        href="/favicon/favicon-96x96.png"
        rel="icon"
        sizes="96x96"
        type="image/png"
      />
      <link href="/favicon/favicon.svg" rel="icon" type="image/svg+xml" />
      <link href="/favicon/favicon.ico" rel="shortcut icon" />
      <link
        href="/favicon/apple-touch-icon.png"
        rel="apple-touch-icon"
        sizes="180x180"
      />
      <meta
        content="#F85522"
        media="(prefers-color-scheme: light)"
        name="theme-color"
      />
      <meta
        content="#F85522"
        media="(prefers-color-scheme: dark)"
        name="theme-color"
      />
      <meta content="yes" name="mobile-web-app-capable" />
      <meta content="yes" name="apple-mobile-web-app-capable" />
      <meta content="default" name="apple-mobile-web-app-status-bar-style" />
      <meta content="Asocialmedia" name="apple-mobile-web-app-title" />
      <link href="/site.webmanifest" rel="manifest" />
      <script
        data-website-id="e9ee46c1-9c4a-4e03-a5e0-133af1b65fb9"
        defer
        src="https://tracking.przknv.cc/script.js"
      />
    </head>
    <body className={"min-h-screen font-sans antialiased"}>
      <DesignSystemProvider>{children}</DesignSystemProvider>
    </body>
  </html>
);

export default RootLayout;
