import { create } from "zustand";

import type { FeedMedia, FeedPost } from "../lib/feed-types";

export interface MediaBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface MediaPreviewRequest {
  bounds: MediaBounds;
  media: FeedMedia;
  post: FeedPost;
}

interface MediaPreviewState {
  close: () => void;
  open: (request: MediaPreviewRequest) => void;
  request: MediaPreviewRequest | null;
}

// One preview for the app; retained feed rows never allocate a modal or player.
export const useMediaPreviewStore = create<MediaPreviewState>((set) => ({
  close: () => set({ request: null }),
  open: (request) => set({ request }),
  request: null,
}));
