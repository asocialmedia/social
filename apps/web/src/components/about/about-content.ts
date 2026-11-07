export const aboutQuestions = [
  {
    answer:
      "A social network for posts, short videos, communities and conversations, with a feed that learns your interests and Aura that recognises your contributions. Our wider mission is to bring people and the open social web closer together, without turning attention into advertising inventory.",
    question: "What actually is asocialmedia?",
  },
  {
    answer:
      "No. Public feeds, Explore, public communities and profiles are readable as a guest. Make an account when you want to post, reply, bookmark or join a conversation. Private spaces still have their own access rules.",
    question: "Do I have to sign up to look around?",
  },
  {
    answer:
      "The code is published under AGPL-3.0. You can inspect it, modify it, fork it and run your own instance under the licence. That makes the software accountable beyond our promises. The project’s name and artwork have separate trademark terms, and our hosted service has community rules.",
    question: "What does open source mean here?",
  },
  {
    answer:
      "Not yet. Public Bluesky discovery is available alongside native asocialmedia posts, with local follows and interactions. Full federation, posting back to other networks and ActivityPub support are still being built toward. Reading across networks is not the same as being interoperable with all of them.",
    question: "Is this already a federated network?",
  },
  {
    answer:
      "No ads, no selling personal data and no paid shortcuts into everyone’s feed: those are project commitments. We want a place worth spending time in, without a business model built around selling that time. Our privacy policy explains the data the service uses to operate.",
    question: "Are there ads? Can I pay for more reach?",
  },
  {
    answer:
      "No. People need boundaries to feel welcome. Reporting, blocking and moderation belong here too. Open source means you can inspect and change the software; it does not remove the rules of the hosted service or other people’s right to safety.",
    question: "Does open mean anything goes?",
  },
  {
    answer:
      "Zeph is our companion character and system account. The larger vision is a companion that helps you discover people and understand conversations, with meaningful control over personal context. That companion experience is work in progress, not a claim that every planned AI feature is available today.",
    question: "And who is Zeph?",
  },
] as const;

export const experienceNotes = [
  {
    body: "Your interests should have room to change. Discovery learns from what you engage with, while Latest, Trending and Following give you other ways to see what is happening.",
    title: "A feed that gets to know you",
  },
  {
    body: "Aura brings your participation into a reputation system. Useful replies, original posts and showing up for a community should matter beyond a single burst of attention.",
    title: "Good contributions leave a trace",
  },
  {
    body: "Find a community around the thing you could talk about for hours. Share a fleet, reply with an eddy, or post a gust when a short video says it better.",
    title: "Small corners. Actual people.",
  },
  {
    body: "Discover public Bluesky posts alongside asocialmedia. Follow people locally and keep conversations here, while we work toward deeper connections across the open social web.",
    title: "A wider world, in reach",
  },
] as const;

export const networkSteps = [
  {
    body: "Original posts and the conversations underneath them.",
    detail: "Short videos, in a space of their own.",
    first: "Fleets & eddies",
    label: "Native to ASM",
    name: "Create",
    second: "Gusts",
  },
  {
    body: "Spaces built around shared interests and their own rules.",
    detail: "A record of participation across the platform.",
    first: "Communities",
    label: "Native to ASM",
    name: "Belong",
    second: "Aura",
  },
  {
    body: "Public discovery alongside native posts, with source attribution.",
    detail: "Keep up with public Bluesky accounts from ASM.",
    first: "Bluesky",
    label: "Available now",
    name: "Discover",
    second: "Local follows",
  },
  {
    body: "Work toward deeper interaction across compatible networks.",
    detail: "Permissions and moderation remain part of the work.",
    first: "AT Protocol",
    label: "The direction",
    name: "Connect",
    second: "Respect the source",
  },
  {
    body: "Explore connections with Mastodon and the wider Fediverse.",
    detail: "A roadmap is not a list of integrations already shipped.",
    first: "ActivityPub",
    label: "On the horizon",
    name: "Open out",
    second: "No fake checkmarks",
  },
  {
    body: "Inspect, question and improve how this place works.",
    detail: "Report a bug, propose an idea or contribute a change.",
    first: "Read the code",
    label: "In public",
    name: "Build",
    second: "Help shape it",
  },
] as const;

export const aboutPhotos = {
  art: {
    alt: "Ink and watercolor illustration of an artist painting at her easel",
    src: "/about/artwork/art-human.webp",
  },
  code: {
    alt: "A man working on a laptop beside a tiny Zeph desk figurine",
    src: "/about/artwork/code-human.webp",
  },
  heroMusic: {
    alt: "Ink illustration of a man listening to headphones by a tram window",
    src: "/about/artwork/hero-on-repeat.webp",
  },
  making: {
    alt: "Paper collage of a woman sketching an idea in a notebook",
    src: "/about/artwork/making-human.webp",
  },
  music: {
    alt: "Risograph illustration of two friends listening to records",
    src: "/about/artwork/music-human.webp",
  },
  nature: {
    alt: "Two friends pausing on a wooden bridge above a forest stream",
    src: "/about/artwork/hero-outside.webp",
  },
  people: {
    alt: "Painted illustration of three friends talking in a cozy living room",
    src: "/about/artwork/people-human.webp",
  },
  reading: {
    alt: "Pastel illustration of a reader in a neighborhood bookshop",
    src: "/about/artwork/reading-human.webp",
  },
  space: {
    alt: "Gouache illustration of two friends stargazing from a rooftop",
    src: "/about/artwork/space-human.webp",
  },
} as const;
