import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";

import TermsPage from "./client-toc";

export const metadata: Metadata = {
  alternates: { canonical: "/toc" },
  description:
    "Terms and conditions for using asocialmedia. Your rights, content ownership, acceptable use guidelines, community standards, and the licence the software itself ships under.",
  openGraph: {
    description:
      "Your rights, content ownership, acceptable use, and the open source licence asocialmedia ships under.",
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
