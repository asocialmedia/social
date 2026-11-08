// Platform share targets, ported from web's socialShareOptions
// (apps/web/src/components/home/feedview/share-button.tsx). Web opens each
// platform share URL in a new tab and records trackShare/trackClick stats;
// native opens the same URLs via Linking and records the same submitShare /
// submitShareClick stats in the share sheet. Instagram has no web share
// intent, so web copies the link and opens instagram.com; Pinterest needs the
// post thumbnail as media plus the description.
export interface ShareTargetOptions {
  description?: string;
  mediaUrl?: string | null;
}

export function socialShareTargets(
  url: string,
  text: string,
  options: ShareTargetOptions = {}
) {
  const link = encodeURIComponent(url);
  const caption = encodeURIComponent(text);
  const media = encodeURIComponent(options.mediaUrl ?? "");
  const description = encodeURIComponent(options.description ?? text);
  return [
    {
      label: "X",
      platform: "twitter",
      url: `https://twitter.com/intent/tweet?url=${link}&text=${caption}`,
    },
    {
      label: "Facebook",
      platform: "facebook",
      url: `https://www.facebook.com/sharer/sharer.php?u=${link}`,
    },
    {
      label: "LinkedIn",
      platform: "linkedin",
      url: `https://www.linkedin.com/sharing/share-offsite/?url=${link}`,
    },
    {
      copyFirst: true,
      label: "Instagram",
      platform: "instagram",
      url: "https://instagram.com/",
    },
    {
      label: "Pinterest",
      platform: "pinterest",
      url: `https://pinterest.com/pin/create/button/?url=${link}&media=${media}&description=${description}`,
    },
    {
      label: "Reddit",
      platform: "reddit",
      url: `https://www.reddit.com/submit?url=${link}&title=${caption}`,
    },
    {
      label: "WhatsApp",
      platform: "whatsapp",
      url: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
    },
    {
      label: "Discord",
      platform: "discord",
      url: `https://discord.com/channels/@me?message=${encodeURIComponent(`${text} ${url}`)}`,
    },
    {
      label: "Email",
      platform: "email",
      url: `mailto:?subject=${caption}&body=${link}`,
    },
  ];
}
