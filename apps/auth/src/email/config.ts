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
          "Experience all your social media in one place. Asocialmedia seamlessly aggregates content from Twitter, Reddit, 4chan, and more into a single, customizable feed. No more platform hopping!",
        emoji: "🌐 ",
        title: "Unified Social Feed",
      },
      {
        description:
          "Take control of your social media consumption with powerful filters, custom categories, and real-time updates. Save time and never miss important content from your favorite platforms.",
        emoji: "⚡ ",
        title: "Streamlined Experience",
      },
      {
        description:
          "Asocialmedia is proudly Free and Open Source Software (FOSS). Inspect the code, suggest features, contribute improvements, and help build a more connected social media experience for everyone. More eyes make for better software!",
        emoji: "🐙 ",
        title: "Open Source Freedom",
      },
    ],
    logoUrl: "https://zr2.asocialmedia.cc/Assets/zephyr-logo.png",
  },

  company: {
    name: "Asocialmedia",
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
      "Asocialmedia is a social media aggregator that aggregates content from various social media platforms and displays them in a single feed. Completely FOSS and open to contributions.",
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
      subject: "Reset Your Password",
    },
    verification: {
      buttonText: "Verify Email Address",
      expiryTime: "1 hour",
      subject: "🎉 One Last Step to Join the Asocialmedia!",
    },
  },
};
