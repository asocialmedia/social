export const siteConfig = {
  authors: [{ name: "parazeeknova", url: "https://przknv.cc" }],
  creator: "Harsh Sahu",
  description:
    "The last social platform you'll ever need. Open source, cozy, and slightly unhinged. Share posts, follow the global feed, and join the conversation — no account needed to browse.",
  keywords: [
    "social platform",
    "content aggregator",
    "open source",
    "community",
    "social media",
    "content creation",
    "collaboration",
    "FOSS",
    "developer community",
    "knowledge sharing",
    "social networking",
    "tech community",
    "content discovery",
    "digital collaboration",
    "asocialmedia",
    "global feed",
    "eddie",
  ].join(", "),
  links: {
    github: "https://github.com/asocialmedia/social",
    twitter: "https://twitter.com/parazeeknova",
  },
  locale: "en_US",
  name: "Asocialmedia",
  // Resolved against metadataBase, so this must be a root-absolute path or a
  // full URL. Used for the default social share card.
  ogImage: "/favicon/og-image.png",
  siteName: "Asocialmedia",
  twitterCreator: "Harsh Sahu | parazeeknova",
  twitterHandle: "@asocialmedia",
  url: "https://asocialmedia.cc",
} as const;
