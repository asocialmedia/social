import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { useSessionContext } from "@/features/auth/state/session";
import { BioContent } from "@/features/home/components/bio-content";
import { useProtocolResource } from "@/features/network/state/use-protocol-resource";
import { SettingsButton } from "@/features/settings/components/settings-ui";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { cachedExternalPost } from "../lib/external-cache";
import { readExternal } from "../lib/external-interactions";
import { externalPostView } from "../lib/external-post-view";
import { MediaGallery, ExplicitGate } from "./post-media";

export function ExternalResponseParent({ uri }: { uri: string }) {
  const { user } = useSessionContext();
  const { theme } = useAppTheme();
  const router = useRouter();
  const query = useProtocolResource(
    `external-parent:${user?.id ?? "guest"}:${uri}`,
    async (signal) => {
      const result = await readExternal(uri, undefined, signal);
      return result.post;
    }
  );
  const post =
    query.data === undefined
      ? cachedExternalPost(uri, user?.id ?? "guest")
      : query.data;
  const presented = post ? externalPostView(post) : null;
  const media = presented?.attachments?.length ? (
    <MediaGallery
      apiBase={getApiBaseUrl()}
      attachments={presented.attachments}
      postId={uri}
      post={presented}
      onPressMedia={(index) =>
        router.push({
          params: { index: String(index), uri },
          pathname: "/external-media",
        })
      }
    />
  ) : null;
  const gatedMedia = presented?.explicitContent ? (
    <ExplicitGate
      apiBase={getApiBaseUrl()}
      attachments={presented.attachments ?? []}
      revealKey={uri}
    >
      {media}
    </ExplicitGate>
  ) : (
    media
  );
  return (
    <View
      className="mb-3 gap-2 px-4 py-2"
      style={{ borderLeftColor: theme.cardBorder, borderLeftWidth: 2 }}
    >
      {post ? (
        <>
          <SettingsButton
            tone="gray"
            size="sm"
            label={`${post.author.displayName} · @${post.author.handle}`}
            onPress={() =>
              router.push({
                params: { actor: post.author.id },
                pathname: "/external-profile",
              })
            }
          />
          <BioContent
            apiBase={getApiBaseUrl()}
            bio={post.text}
            sourceSegments={post.segments}
            clampLength={400}
          />
          {gatedMedia}
          <SettingsButton
            tone="gray"
            size="sm"
            label="Open original post"
            onPress={() =>
              router.push({ params: { uri }, pathname: "/external-post" })
            }
          />
        </>
      ) : (
        <Text style={{ color: theme.dividerText }}>
          {query.loading
            ? "Loading original Bluesky post…"
            : query.error ||
              "The original source post is unavailable. Its ASM response is preserved."}
        </Text>
      )}
      {query.error ? (
        <SettingsButton
          label="Retry original post"
          tone="gray"
          size="sm"
          onPress={() => {
            void query.refetch();
          }}
        />
      ) : null}
    </View>
  );
}
