import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";

import { AboutBuild, AboutFooter } from "@/components/about/about-closing";
import {
  AboutParticipation,
  AboutPrinciples,
  AboutQuestions,
  AboutStories,
} from "@/components/about/about-community";
import { aboutQuestions } from "@/components/about/about-content";
import { AboutExperience } from "@/components/about/about-experience";
import { AboutFeatures } from "@/components/about/about-features";
import { AboutMotion } from "@/components/about/about-motion";
import { AboutNavigation } from "@/components/about/about-navigation";
import { AboutJoin, AboutNetworks } from "@/components/about/about-networks";
import { AboutOpening } from "@/components/about/about-opening";
import JsonLd from "@/components/seo/json-ld";

import "@/components/about/about.css";

const description =
  "A place for your people, your interests and the wider open social web. Meet asocialmedia: a social network built in the open, without ads or data sales.";
const title = "About asocialmedia — The open social web, closer";
const aboutUrl = `${siteConfig.url}/about`;
const shareImage = {
  alt: "Friends sharing a cozy living room — asocialmedia, the internet a little closer",
  height: 630,
  url: "/about/share.png",
  width: 1200,
};

export const metadata: Metadata = {
  alternates: { canonical: "/about" },
  authors: [...siteConfig.authors],
  description,
  keywords: [
    "asocialmedia",
    "about asocialmedia",
    "open source social network",
    "social media without ads",
    "open social web",
    "Aura",
    "Zeph",
    "online communities",
  ],
  openGraph: {
    description,
    images: [shareImage],
    locale: siteConfig.locale,
    siteName: siteConfig.name,
    title,
    type: "website",
    url: aboutUrl,
  },
  robots: {
    follow: true,
    googleBot: { index: true, "max-image-preview": "large" },
    index: true,
  },
  title: "About — An open social network",
  twitter: {
    card: "summary_large_image",
    creator: "@parazeeknova",
    description,
    images: [shareImage],
    site: siteConfig.twitterHandle,
    title,
  },
};

export default function AboutPage() {
  return (
    <div className="about-page" data-about-page>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: aboutQuestions.map(({ question, answer }) => ({
            "@type": "Question",
            acceptedAnswer: { "@type": "Answer", text: answer },
            name: question,
          })),
        }}
      />
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@id": `${aboutUrl}/#page`,
            "@type": "AboutPage",
            about: { "@id": `${siteConfig.url}/#app` },
            breadcrumb: { "@id": `${aboutUrl}/#breadcrumb` },
            description,
            inLanguage: "en",
            isPartOf: { "@id": `${siteConfig.url}/#website` },
            name: title,
            primaryImageOfPage: {
              "@type": "ImageObject",
              height: shareImage.height,
              url: `${siteConfig.url}${shareImage.url}`,
              width: shareImage.width,
            },
            url: aboutUrl,
          },
          {
            "@context": "https://schema.org",
            "@id": `${aboutUrl}/#breadcrumb`,
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                item: siteConfig.url,
                name: "asocialmedia",
                position: 1,
              },
              {
                "@type": "ListItem",
                item: aboutUrl,
                name: "About",
                position: 2,
              },
            ],
          },
        ]}
      />
      <a className="about-skip-link" href="#about-content">
        Skip to content
      </a>
      <AboutNavigation />
      <main id="about-content">
        <AboutOpening />
        <AboutExperience />
        <AboutFeatures />
        <AboutJoin />
        <AboutNetworks />
        <AboutStories />
        <AboutParticipation />
        <AboutQuestions />
        <AboutPrinciples />
        <AboutBuild />
      </main>
      <AboutFooter />
      <AboutMotion />
    </div>
  );
}
