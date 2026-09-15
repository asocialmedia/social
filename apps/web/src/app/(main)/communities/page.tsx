import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { Suspense } from "react";

import JsonLd from "@/components/seo/json-ld";

import ClientComm from "./client-communities";

export const metadata: Metadata = {
  alternates: { canonical: "/communities" },
  description:
    "Discover communities on asocialmedia. Find your people, join topic-scoped spaces, and post about what you love.",
  keywords: [
    "asocialmedia communities",
    "online communities",
    "forums",
    "discussion",
  ],
  openGraph: {
    description:
      "Discover communities on asocialmedia. Find your people and join the conversation.",
    siteName: siteConfig.name,
    title: "Communities",
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
    name: "Communities on asocialmedia",
    url: `${siteConfig.url}/communities`,
  };

  return (
    <Suspense>
      <JsonLd data={itemListJsonLd} />
      <ClientComm />
    </Suspense>
  );
}
