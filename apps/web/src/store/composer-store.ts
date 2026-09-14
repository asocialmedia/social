import type { Media } from "@asm/db";
import { create } from "zustand";

export type ComposerMode = "post" | "gust";

// The post being responded to when the composer is opened as a response. The
// composer renders a full preview of the parent post and publishes with parentPostId.
export interface ComposerReplyTarget {
  attachments?: Media[] | { id: string; type: string; url?: string }[];
  avatarUrl?: string | null;
  badge?: string | null;
  badges?: string[] | null;
  content?: string;
  createdAt?: Date | string;
  displayName?: string;
  embeds?: unknown;
  id: string;
  isGust?: boolean;
  username: string;
}

interface ComposerState {
  clearReplyTo: () => void;
  closeComposer: () => void;
  isOpen: boolean;
  mode: ComposerMode;
  openComposer: (mode?: ComposerMode, replyTo?: ComposerReplyTarget) => void;
  replyTo: ComposerReplyTarget | null;
  setMode: (mode: ComposerMode) => void;
}

export const useComposerStore = create<ComposerState>()((set) => ({
  clearReplyTo: () => set({ replyTo: null }),
  closeComposer: () => set({ isOpen: false, replyTo: null }),
  isOpen: false,
  mode: "post",
  // Only an explicit mode argument switches the composer. Bare open calls
  // (sidebar "Post" button, profile compose) preserve the current mode so a
  // restored draft reopens as what it was authored as - a gust video draft
  // must never present itself as a fleet attachment after a refresh. A reply
  // target forces the fleet mode (responses are never gusts) and carries the
  // parent so the composer can banner it and publish with parentPostId.
  openComposer: (mode, replyTo) => {
    if (replyTo) {
      // Responses are always fleets; the target also carries the parent.
      set({ isOpen: true, mode: "post", replyTo });
      return;
    }
    set(mode ? { isOpen: true, mode } : { isOpen: true });
  },
  replyTo: null,
  setMode: (mode) => set({ mode }),
}));
