// The brand line runs unchanged across the HTML title, the OG and Twitter
// cards, the web manifest, the Expo app description and llms.txt. One sentence,
// reused verbatim, so every surface a stranger can land on says the same thing.
const brandLine = "The social network that knows you back.";

export const siteConfig = {
  authors: [{ name: "parazeeknova", url: "https://przknv.cc" }],
  brandLine,
  creator: "Harsh Sahu",
  description:
    "asocialmedia is the social network that knows you back. A feed that learns your taste, Aura that remembers what you contribute, and communities you have to earn. No ads, and nothing sold to anyone.",
  // FOSS and open source are deliberately absent here. They are credentials,
  // not positioning, and they live in the FOSS banner, the Terms and the
  // repository. See apps/web/src/app/(docs)/toc for the licensing terms.
  keywords: [
    "asocialmedia",
    "asocialmedia.cc",
    "asocial media",
    "asm social",
    "social network",
    "social media",
    "social media app",
    "personalized social feed",
    "social feed that learns you",
    "social network with memory",
    "reputation system social media",
    "aura social media",
    "social media without ads",
    "chronological social feed",
    "community social network",
    "social media alternative",
    "guest browsing social media",
    "short form video social app",
  ].join(", "),
  links: {
    github: "https://github.com/asocialmedia/social",
    twitter: "https://twitter.com/parazeeknova",
  },
  locale: "en_US",
  name: "asocialmedia",
  // Resolved against metadataBase, so this must be a root-absolute path or a
  // full URL. Used for the default social share card.
  ogImage: "/favicon/og-image.png",
  siteName: "asocialmedia",
  twitterCreator: "Harsh Sahu | parazeeknova",
  twitterHandle: "@asocialmedia",
  url: "https://asocialmedia.cc",
} as const;
