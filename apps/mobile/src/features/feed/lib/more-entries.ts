// Which entries the post overflow menu offers, and in what order.
//
// Split out of more-menu.tsx so it can be unit tested: that file imports
// react-native, which Bun cannot parse, and this logic is the part worth
// asserting on. The rules mirror web's PostMoreButton exactly - a reader gets
// Not interested, the author and staff get moderation, edit tags and delete,
// and Share to feed appears only for a signed-in reader on a community post
// that is not moderated.
//
// No React, react-native or icon imports here on purpose: the icons come from
// lucide-react-native, which reaches react-native, which Bun cannot parse. The
// entry list is therefore pure data - action, label and whether it is
// destructive - and the panel maps an action to its glyph.

import type { FeedPost } from "./feed-types";

export type MoreAction =
  | { type: "delete" }
  | { type: "edit-tags" }
  | { type: "hide" }
  | { type: "moderate" }
  | { type: "share-to-feed" }
  | { type: "toggle-alt" }
  | { type: "toggle-captions" }
  | { type: "toggle-transcript" };

export interface MoreMenuEntry {
  action: MoreAction;
  // Web's `text-destructive` item (the eddie row's Delete).
  destructive?: boolean;
  label: string;
}

// Web's entry list for a post, in web's order.
export function buildMoreEntries(options: {
  post: FeedPost;
  showCaptions: boolean;
  showingAlt: boolean;
  viewerId?: string | null;
  viewerRole?: string | null;
}): MoreMenuEntry[] {
  const { post, showCaptions, showingAlt, viewerId, viewerRole } = options;
  // Same rule as web's canModeratePost: the author always may, staff always
  // may, and a signed-in reader may not touch someone else's post.
  const mayModerate = Boolean(
    viewerId &&
    (viewerId === post.user?.id ||
      viewerRole === "admin" ||
      viewerRole === "moderator")
  );
  const attachments = post.attachments ?? [];
  const entries: MoreMenuEntry[] = [];
  if (viewerId && viewerId !== post.user?.id) {
    entries.push({
      action: { type: "hide" },
      label: "Not interested",
    });
  }
  if (attachments.some((media) => media?.altText)) {
    entries.push({
      action: { type: "toggle-alt" },
      label: showingAlt ? "Hide alt" : "Show alt",
    });
  }
  if (!post.moderated && attachments.some((media) => media?.type === "VIDEO")) {
    entries.push({
      action: { type: "toggle-captions" },
      label: showCaptions ? "Hide captions" : "Show captions",
    });
  }
  if (viewerId && post.community && !post.moderated) {
    entries.push({
      action: { type: "share-to-feed" },
      label: "Share to feed",
    });
  }
  if (mayModerate) {
    entries.push(
      { action: { type: "moderate" }, label: "Moderation" },
      { action: { type: "edit-tags" }, label: "Edit tags" },
      {
        action: { type: "delete" },
        destructive: true,
        label: "Delete",
      }
    );
  }
  return entries;
}
