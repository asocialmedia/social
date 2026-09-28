// Owns the post overflow menu's dialogs and the four mutations behind it.
//
// The home feed and the profile feed both render the same overflow menu, and
// both used to handle only hide / alt / captions. Delete, moderation, edit
// tags and share-to-feed each need a confirmation or a form, so rather than
// repeat that state in both surfaces this hook returns the entries, an action
// handler and the dialogs to mount. The three existing actions are passed
// through as callbacks because their state belongs to the surface.

import { useCallback, useState } from "react";

import { useComposerStore } from "@/features/composer/state/composer-store";

import { buildMoreEntries } from "../components/more-menu";
import type { MoreAction, MoreMenuEntry } from "../components/more-menu";
import {
  DeletePostDialog,
  EditPostTagsDialog,
  PostModerationDialog,
} from "../components/post-dialogs";
import type { FeedPost } from "../lib/feed-types";

export interface PostOverflowHandlers {
  /** Fired after a delete succeeds, so the surface can drop the row. */
  onDeleted: (postId: string) => void;
  /** Fired after a moderation save, so the surface can patch the post. */
  onModerated: (
    postId: string,
    next: { explicitContent: boolean; moderated: boolean }
  ) => void;
  /** Fired after tags are saved. */
  onTagsSaved: (postId: string, tags: string[]) => void;
  onHide: (post: FeedPost) => void;
  /** Optional: a surface that never offers alt can omit it. */
  onToggleAlt?: (post: FeedPost) => void;
  /** Optional: same for captions. */
  onToggleCaptions?: (post: FeedPost) => void;
  /** The signed-in reader, for the author/staff rule on the new entries. */
  viewerId: string | null;
  viewerRole?: string | null;
}

export function usePostOverflow(handlers: PostOverflowHandlers): {
  dialogs: React.ReactElement;
  entriesFor: (
    post: FeedPost,
    state: { showCaptions: boolean; showingAlt: boolean }
  ) => MoreMenuEntry[];
  onAction: (action: MoreAction, post: FeedPost) => void;
} {
  const openComposer = useComposerStore((state) => state.open);
  const setDraft = useComposerStore((state) => state.setDraft);
  const [deleteTarget, setDeleteTarget] = useState<FeedPost | null>(null);
  const [moderateTarget, setModerateTarget] = useState<FeedPost | null>(null);
  const [tagsTarget, setTagsTarget] = useState<FeedPost | null>(null);

  const entriesFor = useCallback(
    (post: FeedPost, state: { showCaptions: boolean; showingAlt: boolean }) =>
      buildMoreEntries({
        post,
        showCaptions: state.showCaptions,
        showingAlt: state.showingAlt,
        viewerId: handlers.viewerId,
        viewerRole: handlers.viewerRole,
      }),
    [handlers.viewerId, handlers.viewerRole]
  );

  // A handler map rather than a switch: every action resolves to something,
  // and a type with no entry falls through as a no-op instead of needing a
  // default branch that the linter and the formatter argue about.
  const onAction = useCallback(
    (action: MoreAction, post: FeedPost) => {
      if (action.type === "hide") {
        handlers.onHide(post);
        return;
      }
      if (action.type === "toggle-alt") {
        handlers.onToggleAlt?.(post);
        return;
      }
      if (action.type === "toggle-captions") {
        handlers.onToggleCaptions?.(post);
        return;
      }
      if (action.type === "delete") {
        setDeleteTarget(post);
        return;
      }
      if (action.type === "moderate") {
        setModerateTarget(post);
        return;
      }
      if (action.type === "edit-tags") {
        setTagsTarget(post);
        return;
      }
      if (action.type !== "share-to-feed") {
        return;
      }
      // Web's share to feed is not a mutation: it opens the composer
      // pre-filled with the community and the source post, and the publish
      // carries communitySharePostId. The entry is only offered when the post
      // has a community, which buildMoreEntries already checked.
      const { community } = post;
      if (!community) {
        return;
      }
      setDraft({ communityId: community.id, communitySharePostId: post.id });
      openComposer("post", null);
    },
    [handlers, openComposer, setDraft]
  );

  const dialogs = (
    <>
      <DeletePostDialog
        onClose={() => setDeleteTarget(null)}
        onDeleted={(postId) => {
          handlers.onDeleted(postId);
        }}
        open={deleteTarget !== null}
        postId={deleteTarget?.id ?? ""}
      />
      <PostModerationDialog
        explicitContent={moderateTarget?.explicitContent ?? false}
        moderated={moderateTarget?.moderated ?? false}
        onClose={() => setModerateTarget(null)}
        onUpdated={(postId, next) => {
          handlers.onModerated(postId, next);
        }}
        open={moderateTarget !== null}
        postId={moderateTarget?.id ?? ""}
      />
      <EditPostTagsDialog
        initialTags={(tagsTarget?.tags ?? []).map((tag) => tag.name)}
        onClose={() => setTagsTarget(null)}
        onSaved={(postId, tags) => {
          handlers.onTagsSaved(postId, tags);
        }}
        open={tagsTarget !== null}
        postId={tagsTarget?.id ?? ""}
      />
    </>
  );

  return { dialogs, entriesFor, onAction };
}
