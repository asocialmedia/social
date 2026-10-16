import type { ExternalPost } from "@asm/protocols/contracts";
import { useRouter } from "expo-router";
import { ArrowUpRight, EyeOff, VolumeX } from "lucide-react-native";
import { memo, useMemo, useState } from "react";
import { Linking, Share } from "react-native";

import { useSessionContext } from "@/features/auth/state/session";
import { PostDetailCard } from "@/features/post/components/post-detail-card";

import { externalPostView } from "../lib/external-post-view";
import { useExternalFeedback } from "../state/use-external-feedback";
import { MoreMenu } from "./more-menu";
import type { MenuAnchor } from "./more-menu";
import { PostCard } from "./post-card";

export { BlueskyIcon } from "./bluesky-icon";

export const BlueskyPostCard = memo(
  ({
    post,
    detail = false,
    onDiscussion,
  }: {
    post: ExternalPost;
    detail?: boolean;
    onDiscussion?: () => void;
  }) => {
    const view = useMemo(() => externalPostView(post), [post]);
    const { user } = useSessionContext();
    const router = useRouter();
    const [menuPost, setMenuPost] = useState(post);
    const feedback = useExternalFeedback(menuPost);
    const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
    const discussion = () =>
      onDiscussion
        ? onDiscussion()
        : router.push({ params: { uri: post.id }, pathname: "/external-post" });
    const share = () => {
      void Share.share({ message: `${post.text}\n${post.url}` });
    };
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
        <MoreMenu<{ type: "post" | "author" | "open" }>
          anchor={anchor}
          entries={[
            { action: { type: "post" }, icon: EyeOff, label: "Not interested" },
            {
              action: { type: "author" },
              icon: VolumeX,
              label: "Mute author in ASM",
            },
            {
              action: { type: "open" },
              icon: ArrowUpRight,
              label: "Open on Bluesky",
            },
          ]}
          onAction={({ type }) => {
            if (type === "open") {
              void Linking.openURL(menuPost.url);
            } else {
              void feedback(type);
            }
          }}
          onClose={() => setAnchor(null)}
        />
      </>
    );
  }
);
BlueskyPostCard.displayName = "BlueskyPostCard";
