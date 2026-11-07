import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";

import PrivacyPolicyPage from "./client-privacy";

import "@/components/about/about.css";
import "@/components/legal/legal.css";

export const metadata: Metadata = {
  alternates: { canonical: "/privacy" },
  description:
    "Privacy policy and data handling practices for asocialmedia. Learn about our zero surveillance ad tracking, data minimization, and user data ownership.",
  openGraph: {
    description:
      "No ad tracking, data minimisation, and you keep your copyright. What asocialmedia stores and why.",
    images: [
      {
        alt: "asocialmedia — The internet, a little closer",
        height: 630,
        url: "/about/share.png",
        width: 1200,
      },
    ],
    siteName: siteConfig.name,
    title: `Privacy Policy — ${siteConfig.name}`,
    type: "website",
    url: `${siteConfig.url}/privacy`,
  },
  title: "Privacy Policy",
  twitter: {
    card: "summary_large_image",
    description: "What asocialmedia stores, why it needs it, and your choices.",
    images: ["/about/share.png"],
    title: "Privacy Policy | asocialmedia",
  },
};

export default function PrivacyPage() {
  return <PrivacyPolicyPage />;
}
