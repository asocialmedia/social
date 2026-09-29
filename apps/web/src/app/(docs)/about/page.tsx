import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import Link from "next/link";

import JsonLd from "@/components/seo/json-ld";

// The homepage is the live feed, so this is where the product is actually
// described. It is also the page a brand-name or "what is asocialmedia" query
// lands on, which is why every claim below is concrete enough to be checked
// against the code rather than decorative.
const PILLARS = [
  {
    body: "A taste profile builds from what you read, amplify, bookmark, discuss and search, and it runs on a knowledge graph of the posts, tags and media you engage with. The fourth week does not look like the first. Tell it you are not interested and it drops that post for good, not until the next refresh.",
    term: "The feed learns",
  },
  {
    body: "Most platforms count likes. Aura is a reputation ledger across posting, being useful in a community, replies, bookmarks and follows. Credibility weighting, decay and a daily income cap sit on top of it, so the score resists a brigade and cannot simply be bought.",
    term: "Aura keeps the score",
  },
  {
    body: "Four feeds you can switch between whenever you want. Founding a community is not free: you earn standing first, on a ladder that only goes up. And the whole thing reads as a guest, with no account and no install.",
    term: "You stay in charge",
  },
] as const;

const MORE = [
  {
    body: "A full-screen vertical feed of short video, with the keyboard, mute and comment controls you would expect and nothing you do not.",
    term: "Gusts",
  },
  {
    body: "Every asset gets a C2PA provenance manifest, EXIF and GPS are stripped on upload, and AI-generated media is flagged server-side. Re-encoding a file does not remove the flag.",
    term: "Provenance you cannot edit away",
  },
  {
    body: "Zeph issues moderation notices so the person behind the ban is never the one exposed. End-to-end read receipts, edit and delete for everyone, and history that stays on your device if you ever need to reset.",
    term: "Messages and moderation",
  },
  {
    body: "Read HackerNews inside the app and reshare any story as a fleet. The code is free and open source under the AGPL, developed in the open.",
    term: "Open by default",
  },
] as const;

const ANSWERS = [
  {
    a: "A social network where the feed learns your taste, Aura records your reputation, and communities are earned rather than spammed. Fleets are posts, eddies are comments, and a gust is a short-form video.",
    q: "What is asocialmedia?",
  },
  {
    a: "No. The feed, Explore, communities, hashtags and public profiles all read as a guest. You need an account to post, comment, message or bookmark.",
    q: "Do I need an account to use it?",
  },
  {
    a: "Yes. It is free and open-source software under the AGPL licence, and you can read it, run it and fork it. The source is on GitHub.",
    q: "Is asocialmedia open source?",
  },
  {
    a: "There are no ads and nothing is sold to anyone. You are not a metric, and Aura belongs to you and is not transferable.",
    q: "Are there ads, and is my data sold?",
  },
] as const;

export const metadata: Metadata = {
  alternates: { canonical: "/about" },
  description: siteConfig.description,
  keywords: [
    "what is asocialmedia",
    "about asocialmedia",
    "asocialmedia social network",
    "personalized social feed",
    "aura reputation social media",
  ],
  openGraph: {
    description: siteConfig.description,
    locale: siteConfig.locale,
    siteName: siteConfig.name,
    title: `About ${siteConfig.name}`,
    type: "website",
    url: `${siteConfig.url}/about`,
  },
  title: "About",
};

// The same ANSWERS that render below, so the structured data can never claim
// a question the page does not actually answer.
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: ANSWERS.map((entry) => ({
    "@type": "Question",
    acceptedAnswer: { "@type": "Answer", text: entry.a },
    name: entry.q,
  })),
};

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <JsonLd data={faqJsonLd} />

      <h1 className="text-foreground text-3xl leading-tight font-semibold text-balance sm:text-4xl">
        {siteConfig.brandLine}
      </h1>
      <p className="text-muted-foreground mt-5 text-pretty">
        asocialmedia is a social network built around a simple bet: that the
        feed should get sharper the longer you stay, that your reputation should
        reflect what you actually contribute, and that the room should be yours
        to shape. There are no ads here, and no ads coming.
      </p>

      <h2 className="text-foreground mt-16 text-xl font-semibold">
        What makes it different
      </h2>
      <dl className="mt-6 space-y-7">
        {PILLARS.map((pillar) => (
          <div key={pillar.term}>
            <dt className="text-foreground font-semibold">{pillar.term}</dt>
            <dd className="text-muted-foreground mt-1.5 leading-relaxed text-pretty">
              {pillar.body}
            </dd>
          </div>
        ))}
      </dl>

      <h2 className="text-foreground mt-16 text-xl font-semibold">
        Also worth knowing
      </h2>
      <dl className="mt-6 space-y-7">
        {MORE.map((entry) => (
          <div key={entry.term}>
            <dt className="text-foreground font-semibold">{entry.term}</dt>
            <dd className="text-muted-foreground mt-1.5 leading-relaxed text-pretty">
              {entry.body}
            </dd>
          </div>
        ))}
      </dl>

      <h2 className="text-foreground mt-16 text-xl font-semibold">
        Common questions
      </h2>
      <dl className="mt-6 space-y-7">
        {ANSWERS.map((entry) => (
          <div key={entry.q}>
            <dt className="text-foreground font-semibold">{entry.q}</dt>
            <dd className="text-muted-foreground mt-1.5 leading-relaxed text-pretty">
              {entry.a}
            </dd>
          </div>
        ))}
      </dl>

      <nav
        aria-label="Keep reading"
        className="border-border/60 mt-16 flex flex-wrap gap-x-6 gap-y-2 border-t pt-8"
      >
        {[
          { href: "/", label: "Feed" },
          { href: "/discover", label: "Explore" },
          { href: "/communities", label: "Communities" },
          { href: "/privacy", label: "Privacy" },
          { href: "/toc", label: "Terms" },
        ].map((link) => (
          <Link
            className="text-foreground/80 hover:text-foreground text-sm transition-colors"
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
        <a
          className="text-foreground/80 hover:text-foreground text-sm transition-colors"
          href={siteConfig.links.github}
          rel="noopener"
          target="_blank"
        >
          Source code
        </a>
      </nav>
    </div>
  );
}
