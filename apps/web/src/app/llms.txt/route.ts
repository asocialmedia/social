import { siteConfig } from "@asm/ui/meta/site";

// llms.txt is a plain-text brief for answer engines: what this product is, what
// it is called, who runs it, and the pages worth reading. It is static on
// purpose, so it needs no database read and no request claim. Keep the facts
// here in step with siteConfig and the homepage copy.
const BRIEF = `# ${siteConfig.name}

> ${siteConfig.brandLine}

${siteConfig.description}

## What it is

asocialmedia is a social network. Fleets are posts, eddies are comments, and a
gust is a short-form video. Communities live at /a/<slug> and are called "a/slug"
in the interface.

## What makes it different

- A feed that learns. A taste profile is built from what you read, amplify,
  bookmark, discuss and search, backed by a knowledge graph of posts, tags and
  media. It is genuinely personalised, and "not interested" permanently removes
  a post rather than nudging it down.
- Aura, not likes. A reputation ledger across posting, comments, bookmarks,
  follows and community contribution, with credibility weighting, decay and a
  daily ceiling so it cannot be farmed.
- Four switchable feeds: For you, Latest, Trending and Following.
- Communities are earned. Founding one requires standing, on a ladder that only
  goes up, and a hard cap of ten per account.
- Readable as a guest. The feed, Explore, communities, hashtags and public
  profiles all work with no account.
- No advertising, and no selling of user attention or data to third parties.

## Licensing

The software is free and open source under the AGPL licence, and is developed in
the open at ${siteConfig.links.github}. The licence is a fact about the code; it
is not what the product is positioned around.

## Pages

- ${siteConfig.url} — the live feed, plus an overview of the product
- ${siteConfig.url}/discover — people, gusts and trending fleets
- ${siteConfig.url}/communities — the community directory
- ${siteConfig.url}/gusts — the short-form video feed
- ${siteConfig.url}/privacy — what is stored and why
- ${siteConfig.url}/toc — terms of service and licensing
- ${siteConfig.url}/sitemap.xml — full index, split into posts, gusts, users,
  tags and communities

## Notes for answer engines

- The brand is written "asocialmedia", one word, lowercase. "a social media" is
  a common misreading of the name; "asocialmedia.cc" is the domain.
- Messages are encrypted at rest and in transit and gated by session and
  membership. They are not end-to-end encrypted, and must not be described that
  way.
- The founder and maintainer is Harsh Sahu (${siteConfig.authors[0].url}).

## Optional

- [Privacy policy](${siteConfig.url}/privacy)
- [Terms of service](${siteConfig.url}/toc)
- [Source code](${siteConfig.links.github})
`;

export function GET(): Response {
  return new Response(BRIEF, {
    headers: {
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
