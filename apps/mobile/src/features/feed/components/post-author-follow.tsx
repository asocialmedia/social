import { canFollowPostAuthor } from "@asm/protocols/discovery";
import { UserPlus, UserRoundMinus } from "lucide-react-native";
import { Pressable, Text } from "react-native";

import { useSessionContext } from "@/features/auth/state/session";
import { blueskyConnectionSchema } from "@/features/network/lib/bluesky-connection";
import { networkRequest } from "@/features/network/lib/network-api";
import { useProtocolResource } from "@/features/network/state/use-protocol-resource";
import { SettingsButton } from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

import type { FeedPost } from "../lib/feed-types";
import { useAuthorFollow } from "../state/use-author-follow";
import { useExternalFollow } from "../state/use-external-follow";

export function PostAuthorFollow({
  post,
  menu = false,
  onSelected,
}: {
  post: FeedPost;
  menu?: boolean;
  onSelected?: () => void;
}) {
  const { user } = useSessionContext();
  const { theme } = useAppTheme();
  const native = useAuthorFollow(post, user?.id);
  const external = useExternalFollow(
    post.external?.author.id ?? "",
    Boolean(post.external)
  );
  const connection = useProtocolResource(
    `bluesky-connection:${user?.id ?? "guest"}`,
    async (signal) =>
      blueskyConnectionSchema.parse(
        await networkRequest("/api/protocols/bluesky/likes", { signal })
      ),
    Boolean(user && post.external)
  );
  if (
    !canFollowPostAuthor({
      authorId: post.user?.id,
      connectionKnown: Boolean(connection.data),
      externalDid: post.external?.author.id,
      viewerDid: connection.data?.did,
      viewerId: user?.id,
    })
  ) {
    return null;
  }

  const state = post.external ? external : native;
  const { following } = state;
  const label = following ? "Unfollow" : "Follow";
  const toggle = () => {
    void state.toggle();
    onSelected?.();
  };
  if (!menu) {
    return (
      <SettingsButton
        label={following ? "Following" : "Follow"}
        size="sm"
        disabled={state.pending}
        tone={following ? "gray" : "primary"}
        onPress={toggle}
      />
    );
  }
  const Icon = following ? UserRoundMinus : UserPlus;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: state.pending, disabled: state.pending }}
      disabled={state.pending}
      onPress={toggle}
      className="h-9 flex-row items-center gap-3 rounded-lg px-2"
    >
      <Icon size={16} color={theme.inputText} />
      <Text
        style={{
          color: theme.inputText,
          fontFamily: "SofiaProReg",
          fontSize: 14,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
