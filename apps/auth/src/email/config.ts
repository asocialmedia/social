import { env } from "../../env";

export const emailConfig = {
  // Real in-app destinations, keyed to the routes the web app actually serves.
  // Every email links through here so a route rename is a one-line change and
  // no template can drift to a dead path.
  app: {
    // Android ships from the latest GitHub release (an APK), not a live store
    // listing. The Play URL is the eventual store target and is kept here so
    // the button has one source of truth when the listing goes live.
    androidRelease: "https://github.com/asocialmedia/social/releases/latest",
    // Explore. The route is /discover; /explore does not exist.
    discover: `${env.APP_URL}/discover`,
    // The feed. There is no /compose route - the composer is an in-app modal -
    // so the honest target for "make a post" is the feed itself.
    feed: `${env.APP_URL}/`,
    // ?tab= is the switchable-feed deep link the feed controls read.
    feedTrending: `${env.APP_URL}/?tab=trending`,
    playStore:
      "https://play.google.com/store/apps/details?id=cc.asocialmedia.mobile",
    // The profile tab of settings (tabs: profile, account, privacy, security,
    // personalization).
    settingsProfile: `${env.APP_URL}/settings?tab=profile`,
    source: "https://github.com/asocialmedia/social",
  },

  assets: {
    backgroundImage: `${env.APP_URL}/assets/auth/signup-image.jpg`,
    bannerUrl: "https://zr2.asocialmedia.cc/Assets/zephyr-githubanner.jpg",
    colors: {
      border: "rgba(255, 255, 255, 0.08)",
      cardBg: "#232326",
      panelBg: "#1a1a1c",
      primary: "#ff9500",
      primaryDeep: "#e65500",
      primaryHover: "#ffa629",
      secondary: "#1f2937",
      text: "#a6a6ad",
      textDark: "#f4f4f5",
      textLight: "#7b7b82",
      warning: "#c9a57f",
      warningBg: "rgba(255, 149, 0, 0.06)",
      warningBorder: "rgba(255, 149, 0, 0.18)",
    },
    features: [
      {
        description:
          "Four feeds you can switch between at any time. The For you feed builds a picture of your taste from what you read, amplify, bookmark and discuss, so it gets sharper the longer you stay.",
        emoji: "🌐 ",
        title: "A Feed That Learns You",
      },
      {
        description:
          "Most platforms count likes. Aura is a reputation ledger across everything you actually do here, with credibility weighting and a daily ceiling so it cannot be farmed.",
        emoji: "⚡ ",
        title: "Aura, Not Likes",
      },
      {
        description:
          "Founding a community takes earned standing, not a free signup, and every community sets its own rules. You can read the whole platform as a guest, with no account at all.",
        emoji: "🪪 ",
        title: "Earned Communities",
      },
    ],
    // Sofia Pro Soft is the brand face and is self-hosted by the web app.
    // Clients that honour @font-face get the real type; the rest fall back to
    // a system rounded stack (see EMAIL_FONT_STACK), never a Google font.
    fonts: {
      bold: `${env.APP_URL}/fonts/SofiaProSoftBold.woff2`,
      medium: `${env.APP_URL}/fonts/SofiaProSoftMed.woff2`,
      regular: `${env.APP_URL}/fonts/SofiaProSoftReg.woff2`,
    },
    // The rounded brand lockup the onboarding email opens with.
    headerLogo: "https://cdn.asocialmedia.cc/email-header-asm.png",
    // Rasterised marks and step glyphs. Gmail strips inline SVG from HTML, so
    // every icon ships as a PNG served by the web app instead of being drawn
    // in the markup: play-store.png and github.png are the real brand marks.
    icons: {
      account: `${env.APP_URL}/brand/email/icon-account.png`,
      arrow: `${env.APP_URL}/brand/email/arrow.png`,
      compose: `${env.APP_URL}/brand/email/icon-compose.png`,
      feeds: `${env.APP_URL}/brand/email/icon-feeds.png`,
      github: `${env.APP_URL}/brand/email/github.png`,
      people: `${env.APP_URL}/brand/email/icon-people.png`,
      playStore: `${env.APP_URL}/brand/email/play-store.png`,
    },
    logoUrl: "https://zr2.asocialmedia.cc/Assets/zephyr-logo.png",
    welcomeHero: "https://cdn.asocialmedia.cc/asm-welcome-email.png",
  },

  // The same brand line the site, the web manifest and the app description use.
  // It is restated rather than imported: the auth service is its own deployable
  // and must not take a dependency on @asm/ui to read one string. Keep it in
  // step with `brandLine` in packages/ui/meta/site.ts.
  brandLine: "The social network that knows you back.",

  company: {
    name: "asocialmedia",
    supportEmail: env.SUPPORT_EMAIL,
    website: env.APP_URL,
  },

  legal: {
    privacy: {
      text: "Privacy Policy",
      url: `${env.APP_URL}/privacy`,
    },
    terms: {
      text: "Terms of Service",
      url: `${env.APP_URL}/toc`,
    },
    unsubscribe: {
      text: "Unsubscribe",
      url: `${env.APP_URL}/soon`,
    },
  },

  project: {
    description:
      "asocialmedia is an open social network where the feed learns your taste, Aura records your reputation, and communities are earned rather than spammed. There are no ads.",
    links: {
      contribute: "https://github.com/asocialmedia/social/contribute",
      discord: "https://discordapp.com/users/parazeeknova",
      repo: "https://github.com/asocialmedia/social",
    },
    stats: {
      community: "👥 Join Community",
      contribute: "🛠️ Contribute",
      stars: "⭐ Star on GitHub",
    },
  },

  social: {
    discord: {
      icon: "https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/636e0a69f118df70ad7828d4_icon_clyde_blurple_RGB.svg",
      url: "https://discordapp.com/users/parazeeknova",
    },
    github: {
      icon: "https://github.githubassets.com/assets/GitHub-Mark-ea2971cee799.png",
      url: "https://github.com/asocialmedia/social",
    },
  },

  templates: {
    passwordReset: {
      buttonText: "Reset Password",
      expiryTime: "1 hour",
      subject: "Reset your asocialmedia password",
    },
    verification: {
      buttonText: "Verify Email Address",
      expiryTime: "1 hour",
      // Was "🎉 One Last Step to Join the asocialmedia!" — an article before a
      // mass noun. This is the first thing a new user reads from us, so it
      // says the one useful thing and drops the emoji.
      subject: "Verify your email to join asocialmedia",
    },
  },
};
