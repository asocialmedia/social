import { DesignSystemProvider, SofiaProSoft } from "@asm/ui";

import "./globals.css";
import { colors } from "@asm/ui/meta/colors";
import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import JsonLd from "@/components/seo/json-ld";

export const viewport: Viewport = {
  themeColor: [
    { color: colors.light.primary, media: "(prefers-color-scheme: light)" },
    { color: colors.dark.primary, media: "(prefers-color-scheme: dark)" },
  ],
};

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
  applicationName: siteConfig.name,
  authors: [...siteConfig.authors],
  category: "social",
  classification: "Social Media",
  creator: siteConfig.creator,
  description: siteConfig.description,
  formatDetection: {
    telephone: false,
  },
  icons: {
    apple: [
      {
        sizes: "180x180",
        type: "image/png",
        url: "/favicon/apple-touch-icon.png",
      },
    ],
    icon: [
      { url: "/favicon/favicon.ico" },
      { sizes: "16x16", type: "image/png", url: "/favicon/favicon-16x16.png" },
      { sizes: "32x32", type: "image/png", url: "/favicon/favicon-32x32.png" },
    ],
    other: [
      {
        color: colors.light.primary,
        rel: "mask-icon",
        url: "/favicon/maskable_icon.png",
      },
    ],
  },
  keywords: siteConfig.keywords,
  manifest: "/site.webmanifest",
  metadataBase: new URL(siteConfig.url),
  openGraph: {
    description: siteConfig.description,
    images: [
      {
        alt: siteConfig.name,
        height: 630,
        url: siteConfig.ogImage,
        width: 1200,
      },
    ],
    locale: siteConfig.locale,
    siteName: siteConfig.name,
    title: siteConfig.name,
    type: "website",
    url: siteConfig.url,
  },
  publisher: siteConfig.creator,
  robots: {
    follow: true,
    googleBot: {
      follow: true,
      index: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
    index: true,
  },
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  twitter: {
    card: "summary_large_image",
    creator: siteConfig.twitterCreator,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
    title: siteConfig.name,
  },
  verification: {
    me: ["https://przknv.cc"],
  },
};

interface RootLayoutProperties {
  readonly children: ReactNode;
}

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  description: siteConfig.description,
  inLanguage: "en",
  name: siteConfig.name,
  potentialAction: {
    "@type": "SearchAction",
    "query-input": "required name=search_term_string",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${siteConfig.url}/search?q={search_term_string}`,
    },
  },
  publisher: {
    "@type": "Organization",
    logo: {
      "@type": "ImageObject",
      url: `${siteConfig.url}/favicon/android-chrome-512x512.png`,
    },
    name: siteConfig.name,
    url: siteConfig.url,
  },
  url: siteConfig.url,
};

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
      <meta content="asocialmedia" name="apple-mobile-web-app-title" />
      <link href="/site.webmanifest" rel="manifest" />
      {process.env.NODE_ENV === "production" ? (
        <>
          <link href="https://tracking.przknv.cc" rel="preconnect" />
          <script
            data-website-id="e9ee46c1-9c4a-4e03-a5e0-133af1b65fb9"
            defer
            src="https://tracking.przknv.cc/script.js"
          />
        </>
      ) : null}
    </head>
    <body className="min-h-screen font-sans antialiased">
      <JsonLd data={websiteJsonLd} />
      <DesignSystemProvider>{children}</DesignSystemProvider>
    </body>
  </html>
);

export default RootLayout;
