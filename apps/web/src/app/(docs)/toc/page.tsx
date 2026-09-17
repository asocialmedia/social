import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";

import TermsPage from "./client-toc";

export const metadata: Metadata = {
  alternates: { canonical: "/toc" },
  description:
    "Terms and conditions for using asocialmedia. Learn about your rights, content ownership, acceptable use guidelines, and community standards on our open source platform.",
  openGraph: {
    description:
      "Terms and conditions for using asocialmedia. User rights, acceptable use policy, and community guidelines for our open source social platform.",
    siteName: siteConfig.name,
    title: `Terms and Conditions — ${siteConfig.name}`,
    type: "website",
    url: `${siteConfig.url}/toc`,
  },
  title: `Terms and Conditions — ${siteConfig.name}`,
};

export default function TermsAndConditionsPage() {
  return <TermsPage />;
}
