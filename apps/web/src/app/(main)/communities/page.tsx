import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { Suspense } from "react";

import JsonLd from "@/components/seo/json-ld";

import ClientComm from "./client-communities";

export const metadata: Metadata = {
  alternates: { canonical: "/communities" },
  description:
    "Browse online communities on asocialmedia. Every community has to be earned into existence, each one sets its own rules, and you can read all of them as a guest.",
  keywords: [
    "asocialmedia communities",
    "online communities",
    "topic communities",
    "forums",
    "discussion",
    "find a community",
    "community social network",
  ],
  openGraph: {
    description:
      "Communities you have to earn your way into. Each sets its own rules. Readable as a guest.",
    siteName: siteConfig.name,
    title: `Communities — ${siteConfig.name}`,
    type: "website",
  },
  title: "Communities",
};

// Synchronous shell so the router streams immediately; the client component
// owns its own data fetching so search/filter never block the route.
export default function Page() {
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    description:
      "Browse communities on asocialmedia, organised by topic and interest.",
    inLanguage: "en",
    isPartOf: {
      "@type": "WebSite",
      name: siteConfig.name,
      url: siteConfig.url,
    },
    name: "Communities on asocialmedia",
    url: `${siteConfig.url}/communities`,
  };

  // Home > Communities, matching the community page's deeper breadcrumb.
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        item: siteConfig.url,
        name: "Home",
        position: 1,
      },
      {
        "@type": "ListItem",
        item: `${siteConfig.url}/communities`,
        name: "Communities",
        position: 2,
      },
    ],
  };

  return (
    <Suspense>
      <JsonLd data={[itemListJsonLd, breadcrumbJsonLd]} />
      <ClientComm />
    </Suspense>
  );
}
