import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";

import PrivacyPolicyPage from "./client-privacy";

export const metadata: Metadata = {
  alternates: { canonical: "/privacy" },
  description:
    "Privacy policy and data handling practices for asocialmedia. Learn about our zero surveillance ad tracking, data minimization, and user data ownership.",
  openGraph: {
    description:
      "No ad tracking, data minimisation, and you keep your copyright. What asocialmedia stores and why.",
    siteName: siteConfig.name,
    title: `Privacy Policy — ${siteConfig.name}`,
    type: "website",
    url: `${siteConfig.url}/privacy`,
  },
  title: `Privacy Policy — ${siteConfig.name}`,
};

export default function PrivacyPage() {
  return <PrivacyPolicyPage />;
}
