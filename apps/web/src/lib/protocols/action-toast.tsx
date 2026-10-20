import type { ExternalMutation } from "@asm/protocols/discovery";
import { BookmarkCheck, BookmarkX, Flame, MessageCircle } from "lucide-react";

export function externalActionToast(input: ExternalMutation) {
  if (input.action === "bookmark") {
    return {
      description: input.active
        ? "Saved to your asocialmedia bookmarks."
        : "Removed from your bookmarks.",
      icon: input.active ? <BookmarkCheck /> : <BookmarkX />,
      title: input.active ? "Bookmarked" : "Bookmark Removed",
    };
  }
  if (input.action === "amplify") {
    return {
      description: input.active
        ? "You boosted this Bluesky post in asocialmedia."
        : "You can amplify it again anytime.",
      icon: <Flame color="#ff7a00" fill="#ff7a00" />,
      styles: { badge: "flame-only" },
      title: input.active ? "+1 Aura" : "Amplification Removed",
    };
  }
  return {
    icon: <MessageCircle />,
    title: input.action === "comment" ? "Eddy posted" : "Eddy deleted",
  };
}
