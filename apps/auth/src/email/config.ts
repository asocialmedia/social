import { env } from "../../env";

export const emailConfig = {
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
    logoUrl: "https://zr2.asocialmedia.cc/Assets/zephyr-logo.png",
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
