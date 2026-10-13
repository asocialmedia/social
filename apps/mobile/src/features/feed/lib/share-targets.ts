export function socialShareTargets(url: string, text: string) {
  const link = encodeURIComponent(url);
  const caption = encodeURIComponent(text);
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
      label: "Email",
      platform: "email",
      url: `mailto:?subject=${caption}&body=${link}`,
    },
  ];
}
