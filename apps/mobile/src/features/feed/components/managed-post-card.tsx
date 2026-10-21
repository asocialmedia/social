import { useState } from "react";

import { useSessionContext } from "@/features/auth/state/session";

import type { FeedPost } from "../lib/feed-types";
import { MoreMenu } from "./more-menu";
import type { MenuAnchor } from "./more-menu";
import { PostCard } from "./post-card";
import { ShareSheet } from "./share-sheet";
import { usePostOverflow } from "./use-post-overflow";

export function ManagedPostCard({
  post: initial,
  hasThreadParent = false,
  hasThreadChild = false,
  onChanged,
}: {
  post: FeedPost;
  hasThreadParent?: boolean;
  hasThreadChild?: boolean;
  onChanged?: () => void;
}) {
  const { user } = useSessionContext();
  const [post, setPost] = useState(initial);
  const [hidden, setHidden] = useState(false);
  const [alt, setAlt] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [sharing, setSharing] = useState(false);
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setPost(initial);
  }
  const overflow = usePostOverflow({
    onDeleted: () => {
      setHidden(true);
      onChanged?.();
    },
    onHide: () => setHidden(true),
    onModerated: (_id, patch) => {
      setPost((current) => ({ ...current, ...patch }));
      onChanged?.();
    },
    onTagsSaved: () => onChanged?.(),
    onToggleAlt: () => setAlt((current) => !current),
    viewerId: user?.id ?? null,
  });
  if (hidden) {
    return null;
  }
  return (
    <>
      <PostCard
        post={post}
        viewerId={user?.id}
        hasThreadParent={hasThreadParent}
        hasThreadChild={hasThreadChild}
        showAlt={alt}
        onMore={(_post, next) => setAnchor(next)}
        onShare={() => setSharing(true)}
      />
      <MoreMenu
        anchor={anchor}
        entries={overflow.entriesFor(post, {
          showCaptions: false,
          showingAlt: alt,
        })}
        onClose={() => setAnchor(null)}
        onAction={(action) => overflow.onAction(action, post)}
      />
      <ShareSheet
        post={sharing ? post : null}
        onClose={() => setSharing(false)}
      />
      {overflow.dialogs}
    </>
  );
}
