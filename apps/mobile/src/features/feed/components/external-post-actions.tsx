import type { ExternalPost } from "@asm/protocols/contracts";
import { externalReplyTarget } from "@asm/protocols/discovery";
import { useRouter } from "expo-router";
import { CornerDownRight, MessageSquare } from "lucide-react-native";
import { Share, View } from "react-native";

import { useSessionContext } from "@/features/auth/state/session";
import { useComposerStore } from "@/features/composer/state/composer-store";
import { externalShareUrl } from "@/features/network/lib/network-paths";
import { useAppTheme } from "@/theme";

import { useExternalFeedback } from "../state/use-external-feedback";
import { useExternalInteractions } from "../state/use-external-interactions";
import { ExternalLikeAction } from "./external-like-action";
import {
  BookmarkAction,
  CountButton,
  PostActionRow,
  ShareButton,
  VoteCluster,
} from "./post-actions";

export function ExternalPostActions({
  post,
  onDiscussion,
  hideBookmark = false,
}: {
  post: ExternalPost;
  onDiscussion: () => void;
  hideBookmark?: boolean;
}) {
  const { theme } = useAppTheme();
  const { user } = useSessionContext();
  const router = useRouter();
  const openComposer = useComposerStore((state) => state.open);
  const interaction = useExternalInteractions(post);
  return (
    <PostActionRow>
      <ExternalVoteAction post={post} />
      <CountButton
        count={interaction.state.comments}
        icon={<MessageSquare color={theme.dividerText} size={16} />}
        label="Comments in asocialmedia"
        onPress={onDiscussion}
      />
      <CountButton
        count={interaction.state.responses ?? 0}
        icon={<CornerDownRight color={theme.dividerText} size={16} />}
        label="Respond to this post"
        onPress={() => {
          if (!user) {
            router.push("/(auth)/login");
            return;
          }
          openComposer("post", externalReplyTarget(post));
        }}
      />
      <View className="flex-row items-center gap-1">
        <ShareButton
          onPress={() => {
            void Share.share({
              message: `${post.text}\n${externalShareUrl(post.id)}`,
            });
          }}
        />
        {hideBookmark ? null : <ExternalBookmarkAction post={post} />}
      </View>
    </PostActionRow>
  );
}

export function ExternalBookmarkAction({
  post,
  inactiveColor,
  size,
}: {
  post: ExternalPost;
  inactiveColor?: string;
  size?: number;
}) {
  const interaction = useExternalInteractions(post);
  return (
    <BookmarkAction
      inactiveColor={inactiveColor}
      size={size}
      active={interaction.state.bookmarked}
      disabled={interaction.pending}
      onPress={() => {
        void interaction.mutate({
          action: "bookmark",
          active: !interaction.state.bookmarked,
          uri: post.id,
        });
      }}
    />
  );
}

export function ExternalVoteAction({
  post,
  inactiveColor,
  labelColor,
  size,
}: {
  post: ExternalPost;
  inactiveColor?: string;
  labelColor?: string;
  size?: number;
}) {
  const { user } = useSessionContext();
  const router = useRouter();
  const interaction = useExternalInteractions(post);
  const feedback = useExternalFeedback(post);
  return (
    <VoteCluster
      engagement={
        <ExternalLikeAction
          post={post}
          color={labelColor ?? inactiveColor}
          size={size ? Math.round(size * 0.57) : 16}
        />
      }
      likeCount={post.upstreamCounts.likes ?? null}
      inactiveColor={inactiveColor}
      labelColor={labelColor}
      size={size}
      aura={interaction.state.amplifications}
      authorName={post.author.displayName}
      onRequireLogin={() => router.push("/(auth)/login")}
      postId={post.id}
      userVote={interaction.state.amplified ? 1 : 0}
      viewerId={user?.id ?? null}
      controller={{
        aura: interaction.state.amplifications,
        userVote: interaction.state.amplified ? 1 : 0,
        vote: (value) => {
          if (value === 1) {
            void interaction.mutate({
              action: "amplify",
              active: !interaction.state.amplified,
              uri: post.id,
            });
          } else {
            void feedback("post");
          }
        },
      }}
    />
  );
}
