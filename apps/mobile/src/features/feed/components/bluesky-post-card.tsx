import type { ExternalPost } from "@asm/protocols/contracts";
import { useRouter } from "expo-router";
import {
  ArrowUpRight,
  EyeOff,
  UserPlus,
  UserRoundMinus,
} from "lucide-react-native";
import { memo, useEffect, useMemo, useState } from "react";
import { Linking } from "react-native";

import { useSessionContext } from "@/features/auth/state/session";
import { PostDetailCard } from "@/features/post/components/post-detail-card";

import { rememberExternalPost } from "../lib/external-cache";
import { externalPostView } from "../lib/external-post-view";
import type { FeedPost } from "../lib/feed-types";
import { useExternalFeedback } from "../state/use-external-feedback";
import { useExternalFollow } from "../state/use-external-follow";
import { MoreMenu } from "./more-menu";
import type { MenuAnchor } from "./more-menu";
import { PostCard } from "./post-card";
import { ShareSheet } from "./share-sheet";

export { BlueskyIcon } from "./bluesky-icon";

export const BlueskyPostCard = memo(
  ({
    post,
    detail = false,
    onDiscussion,
    onShare,
  }: {
    post: ExternalPost;
    detail?: boolean;
    onDiscussion?: () => void;
    onShare?: (post: FeedPost) => void;
  }) => {
    const view = useMemo(() => externalPostView(post), [post]);
    const { user } = useSessionContext();
    const router = useRouter();
    useEffect(
      () => rememberExternalPost(post, user?.id ?? "guest"),
      [post, user?.id]
    );
    const [menuPost, setMenuPost] = useState(post);
    const feedback = useExternalFeedback(menuPost);
    const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
    const follow = useExternalFollow(menuPost.author.id, Boolean(anchor));
    let followLabel = follow.following ? "Unfollow in ASM" : "Follow in ASM";
    if (follow.pending) {
      followLabel = "Loading follow…";
    }
    if (follow.failed) {
      followLabel = "Retry follow state";
    }
    const discussion = () =>
      onDiscussion
        ? onDiscussion()
        : router.push({ params: { uri: post.id }, pathname: "/external-post" });
    // Web's ExternalShareButton opens the in-app share dialog. Surfaces that
    // already mount a ShareSheet pass onShare so one sheet serves the list;
    // a card without one falls back to its own sheet, mounted only while open.
    const [localShare, setLocalShare] = useState<FeedPost | null>(null);
    const share = (target: FeedPost) =>
      onShare ? onShare(target) : setLocalShare(target);
    return (
      <>
        {detail ? (
          <PostDetailCard
            onMore={(target, next) => {
              setMenuPost(target.external ?? post);
              setAnchor(next);
            }}
            onOpenMedia={(index) =>
              router.push({
                params: { index: String(index), uri: post.id },
                pathname: "/external-media",
              })
            }
            onShare={share}
            onToggleEddies={discussion}
            post={view}
            viewerId={user?.id}
          />
        ) : (
          <PostCard
            hasThreadChild={false}
            hasThreadParent={false}
            onMore={(target, next) => {
              setMenuPost(target.external ?? post);
              setAnchor(next);
            }}
            onShare={share}
            post={view}
            viewerId={user?.id}
          />
        )}
        <MoreMenu<{ type: "post" | "author" | "open" | "follow" }>
          anchor={anchor}
          entries={[
            {
              action: { type: "follow" },
              icon: UserPlus,
              label: followLabel,
            },
            { action: { type: "post" }, icon: EyeOff, label: "Not interested" },
            {
              action: { type: "author" },
              icon: UserRoundMinus,
              label: "Mute author in asocialmedia",
            },
            {
              action: { type: "open" },
              icon: ArrowUpRight,
              label: "Open on Bluesky",
            },
          ]}
          onAction={({ type }) => {
            if (type === "follow") {
              void follow.toggle();
            } else if (type === "open") {
              void Linking.openURL(menuPost.url);
            } else {
              void feedback(type);
            }
          }}
          onClose={() => setAnchor(null)}
        />
        {onShare ? null : (
          <ShareSheet onClose={() => setLocalShare(null)} post={localShare} />
        )}
      </>
    );
  }
);
BlueskyPostCard.displayName = "BlueskyPostCard";
