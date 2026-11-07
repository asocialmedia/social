// Composer open/close state, ported from web's store/composer-store.ts.
// Passing a reply target opens a Respond (a threaded post reply): it forces
// fleet mode, since responses are always fleets.
import { create } from "zustand";

import type {
  FeedMedia,
  FeedPost,
  FeedUser,
} from "@/features/feed/lib/feed-types";
import { hydrateAttachmentDrafts } from "@/features/media-upload/state/attachment-store";
import { haptic } from "@/lib/interaction/haptics";

import {
  draftForComposerOpen,
  draftWithContext,
  resolveComposerMode,
} from "../lib/composer-context";
import type { ComposerContext } from "../lib/composer-context";
import {
  clearPendingHnShare,
  loadPendingHnShare,
  savePendingHnShare,
} from "../lib/hn-share-persist";
import type { HnShareStorage } from "../lib/hn-share-persist";
import type { MentionPick } from "../lib/inline-relations";

export type ComposerMode = "gust" | "post";

// SecureStore backing for the pending HN share. Dynamic import: the store
// module loads under bun tests, where expo-secure-store cannot parse, and
// only the app runtime ever persists a share.
async function secureHnShareStorage(): Promise<HnShareStorage> {
  const SecureStore = await import("expo-secure-store");
  return {
    getItem: async (key) => {
      try {
        return await SecureStore.getItemAsync(key);
      } catch {
        return null;
      }
    },
    removeItem: async (key) => {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        // Unavailable storage must not break the composer.
      }
    },
    setItem: async (key, value) => {
      try {
        await SecureStore.setItemAsync(key, value);
      } catch {
        // A share that does not fit stays in memory for this session.
      }
    },
  };
}

// A pending share only seeds an empty composer: never clobbers typed text,
// an existing share, or a reply.
function canAdoptPendingShare(state: {
  draft: { hnStory?: HnShareDraft; text: string };
  replyTo: unknown;
}): boolean {
  return (
    !state.replyTo && !state.draft.hnStory && state.draft.text.trim() === ""
  );
}

// Adopts a pending HN share (web's rehydrated useHnShareStore) when the
// composer opens onto an empty draft: guest shares route through login, and
// a cold start drops the in-memory draft, but the pending share survives
// both.
async function adoptPendingHnShare(): Promise<void> {
  if (!canAdoptPendingShare(useComposerStore.getState())) {
    return;
  }
  try {
    const pending = await loadPendingHnShare(await secureHnShareStorage());
    if (!pending) {
      return;
    }
    const fresh = useComposerStore.getState();
    if (!canAdoptPendingShare(fresh)) {
      return;
    }
    useComposerStore
      .getState()
      .setDraft(draftWithContext(fresh.draft, { kind: "hn", story: pending }));
  } catch {
    // A share that cannot load stays out of the composer.
  }
}

export function clearStoredHnShare(): void {
  void (async () => {
    try {
      await clearPendingHnShare(await secureHnShareStorage());
    } catch {
      // Clearing is best-effort; decode drops stale shares instead.
    }
  })();
}

// Stages an HN share before routing a guest to login (web's startSharing
// persists before the navigation too): after login the next composer open
// adopts it. Fire-and-forget; the in-memory draft path is unaffected.
export function stageHnShareForLogin(story: HnShareDraft): void {
  void (async () => {
    try {
      await savePendingHnShare(await secureHnShareStorage(), story);
    } catch {
      // A share that cannot persist still opens when already logged in.
    }
  })();
}

// Explicit publish state machine (audit S0-1): the old `publishing` boolean
// lived in component state, so a second tap before the re-render committed
// read a stale `false` and fired a second POST. Transitions go through
// `beginPublish` (synchronous, store-backed, no stale closures) and publish
// no-ops unless the composer is `editing`.
export type ComposerStatus =
  | { kind: "closed" }
  | { kind: "editing" }
  | { kind: "error"; reason: string }
  | { kind: "publishing"; idempotencyKey: string };

export interface ReplyTarget {
  externalParentUri?: string;
  attachments?: FeedMedia[];
  avatarUrl: string | null;
  badge?: string | null;
  badges?: string[] | null;
  content: string;
  createdAt: string;
  displayName: string | null;
  id: string;
  isGust?: boolean;
  community?: FeedPost["community"];
  communityMemberships?: FeedUser["communityMemberships"];
  embeds?: FeedPost["embeds"];
  hnStoryShare?: FeedPost["hnStoryShare"];
  communityShare?: FeedPost["communityShare"];
  username: string;
}

// The in-progress text and autocomplete picks survive closing the composer
// (web keeps its attachments across a close the same way); publishing or
// discarding clears them.
// The Hacker News story a composer was opened to share, as web sends it.
export interface HnShareDraft {
  by?: string | null;
  descendants?: number | null;
  score?: number | null;
  storyId: number;
  time?: number | null;
  title: string;
  url?: string | null;
}

export interface ComposerDraft {
  gustMentions?: MentionPick[];
  gustTags?: string[];
  // Set when the composer was opened by "Share to feed". The publish carries
  // communitySharePostId so the server records the share side row, and a pure
  // reshare is allowed to have no caption of its own.
  communityId?: string;
  communitySlug?: string;
  communitySharePostId?: string;
  communityShare?: {
    sourcePostId: string;
    slug: string;
    name: string;
    accentColor?: string | null;
  };
  // Set by the Hacker News card's "Reshare as fleet".
  hnStory?: HnShareDraft;
  mentions: MentionPick[];
  tags: string[];
  text: string;
}

const EMPTY_DRAFT: ComposerDraft = { mentions: [], tags: [], text: "" };

interface ComposerState {
  beginPublish: (idempotencyKey: string) => boolean;
  clearDraft: () => void;
  close: () => void;
  dismissPublishError: () => void;
  draft: ComposerDraft;
  failPublish: (reason: string) => void;
  resolvePublish: () => void;
  setDraft: (draft: Partial<ComposerDraft>) => void;
  isOpen: boolean;
  mode: ComposerMode;
  open: (mode?: ComposerMode, replyTo?: ReplyTarget | null) => void;
  openWithContext: (context: ComposerContext) => void;
  replyTo: ReplyTarget | null;
  setMode: (mode: ComposerMode) => void;
  clearReplyTo: () => void;
  status: ComposerStatus;
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  beginPublish: (idempotencyKey) => {
    if (!get().isOpen || get().status.kind !== "editing") {
      return false;
    }
    set({ status: { idempotencyKey, kind: "publishing" } });
    return true;
  },
  clearDraft: () => set({ draft: EMPTY_DRAFT }),
  clearReplyTo: () => set({ replyTo: null }),
  close: () =>
    set({ isOpen: false, replyTo: null, status: { kind: "closed" } }),
  dismissPublishError: () => set({ status: { kind: "editing" } }),
  draft: EMPTY_DRAFT,
  failPublish: (reason) =>
    set((state) =>
      state.status.kind === "publishing"
        ? { status: { kind: "error", reason } }
        : state
    ),
  isOpen: false,
  mode: "post",
  open: (mode = "post", replyTo = null) => {
    haptic();
    set((state) => ({
      draft: draftForComposerOpen(state.draft, mode, replyTo !== null),
      isOpen: true,
      mode: resolveComposerMode(replyTo !== null, mode),
      replyTo,
      status: { kind: "editing" },
    }));
    // Restored drafts render without the original bytes; a restored gust
    // video reopens in the gust editor (web's attachment-store mode lockstep).
    void (async () => {
      try {
        const { gustVideo } = await hydrateAttachmentDrafts();
        if (gustVideo) {
          useComposerStore.getState().setMode("gust");
        }
      } catch {
        // Drafts that cannot load stay in memory for this session.
      }
      // A pending HN share (guest share -> login, or a cold start) seeds an
      // empty composer the way web's rehydrated hn-share store does.
      void adoptPendingHnShare();
    })();
  },
  openWithContext: (context) => {
    haptic();
    set((state) => ({
      draft: draftWithContext(state.draft, context),
      isOpen: true,
      mode: "post",
      replyTo: null,
      status: { kind: "editing" },
    }));
    // A share opened straight into the composer persists too, so a cold
    // start between share and publish still restores it; the publish path
    // clears it again. A share opened while logged out never reaches here,
    // so the entry point saves it before routing to login instead.
    if (context.kind === "hn") {
      void (async () => {
        try {
          await savePendingHnShare(await secureHnShareStorage(), context.story);
        } catch {
          // The in-memory draft still carries the story.
        }
      })();
    }
    void hydrateAttachmentDrafts();
    void adoptPendingHnShare();
  },
  replyTo: null,
  resolvePublish: () =>
    set((state) =>
      state.status.kind === "publishing" || state.status.kind === "error"
        ? { status: { kind: "editing" } }
        : state
    ),
  setDraft: (draft) =>
    set((state) => ({ draft: { ...state.draft, ...draft } })),
  setMode: (mode) =>
    // A reply target forces post mode (responses are always posts): opening
    // with a replyTo pins mode, so a later setMode("gust") — including the
    // draft-hydration path — must not produce the contradictory
    // mode=="gust" && replyTo!=null combination.
    set((state) => ({
      mode: resolveComposerMode(state.replyTo !== null, mode),
    })),
  status: { kind: "closed" },
}));

export function replyTargetFromPost(post: FeedPost): ReplyTarget {
  return {
    attachments: post.attachments ?? [],
    avatarUrl: post.user?.avatarUrl ?? null,
    badge: post.user?.badge ?? null,
    badges: post.user?.badges ?? null,
    community: post.community,
    communityMemberships: post.user?.communityMemberships,
    communityShare: post.communityShare,
    content: post.content ?? "",
    createdAt: post.createdAt,
    displayName: post.user?.displayName ?? null,
    embeds: post.embeds,
    hnStoryShare: post.hnStoryShare,
    id: post.id,
    isGust: post.isGust ?? false,
    username: post.user?.username ?? "",
  };
}
