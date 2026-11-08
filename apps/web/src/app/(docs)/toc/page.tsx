import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";

import TermsPage from "./client-toc";

import "@/components/about/about.css";
import "@/components/legal/legal.css";

export const metadata: Metadata = {
  alternates: { canonical: "/toc" },
  description:
    "Terms and conditions for using asocialmedia. Your rights, content ownership, acceptable use guidelines, community standards, and the licence the software itself ships under.",
  openGraph: {
    description:
      "Your rights, content ownership, acceptable use, and the open source licence asocialmedia ships under.",
    images: [
      {
        alt: "asocialmedia — The internet, a little closer",
        height: 630,
        url: "/about/share.png",
        width: 1200,
      },
    ],
    siteName: siteConfig.name,
    title: `Terms and Conditions — ${siteConfig.name}`,
    type: "website",
    url: `${siteConfig.url}/toc`,
  },
  title: "Terms of Service",
  twitter: {
    card: "summary_large_image",
    description:
      "Your rights, content ownership, and the ground rules for sharing this space.",
    images: ["/about/share.png"],
    title: "Terms of Service | asocialmedia",
  },
};

export default function TermsAndConditionsPage() {
  return <TermsPage />;
}
