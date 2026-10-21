import type { ExternalAuthor } from "@asm/protocols/contracts";
import {
  externalAuthorSchema,
  externalPostSchema,
} from "@asm/protocols/discovery";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Linking, Text, View } from "react-native";
import { z } from "zod";

import { useSessionContext } from "@/features/auth/state/session";
import { networkRequest } from "@/features/network/lib/network-api";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { useProtocolPages } from "@/features/network/state/use-protocol-pages";
import {
  seedProtocolResource,
  useProtocolResource,
} from "@/features/network/state/use-protocol-resource";
import { ProfileHeader } from "@/features/profile/components/profile-header";
import type { ProfileHeaderProfile } from "@/features/profile/lib/profile-view-model";
import { SettingsButton } from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

import { cachedExternalAuthor } from "../lib/external-cache";
import { useExternalFollow } from "../state/use-external-follow";
import { BlueskyPostCard } from "./bluesky-post-card";
import { FeedTabs } from "./feed-tabs";

const pageSchema = z.object({
  cursor: z.string().nullable(),
  items: z.array(externalPostSchema).max(50),
});
const TABS = [
  { label: "Posts", value: "posts" },
  { label: "Replies", value: "replies" },
  { label: "Media", value: "media" },
] as const;

function authorProfile(
  author: ExternalAuthor,
  following: boolean
): ProfileHeaderProfile {
  return {
    _count: {
      followers: author.upstreamCounts.followers ?? 0,
      following: author.upstreamCounts.following ?? 0,
      posts: author.upstreamCounts.posts ?? 0,
    },
    aura: 0,
    avatarUrl: author.avatarUrl ?? null,
    badge: null,
    badges: [],
    bannerUrl: author.bannerUrl ?? null,
    bio: author.description ?? null,
    communityMemberships: [],
    createdAt: "",
    customDomain: null,
    displayName: author.displayName,
    followers: [],
    githubUsername: null,
    id: author.id,
    isFollowing: following,
    linkedinUsername: null,
    redditUsername: null,
    twitterUsername: null,
    username: author.handle,
  };
}

export function ExternalProfileScreen() {
  const params = useLocalSearchParams<{ actor?: string }>();
  const actor = params.actor ?? "";
  return <ExternalProfileContent key={actor} actor={actor} />;
}
function ExternalProfileContent({ actor }: { actor: string }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const network = useNetworkSettings();
  const { user } = useSessionContext();
  const [tab, setTab] = useState<"posts" | "replies" | "media">("posts");
  const cached = cachedExternalAuthor(actor);
  const profileKey = `bluesky-profile:${actor}`;
  if (cached) {
    seedProtocolResource(profileKey, cached);
  }
  const profile = useProtocolResource(
    profileKey,
    async (signal) =>
      externalAuthorSchema.parse(
        await networkRequest(
          `/api/protocols/bluesky/profile?${new URLSearchParams({ actor })}`,
          { signal }
        )
      ),
    Boolean(actor)
  );
  const author = profile.data;
  const follow = useExternalFollow(author?.id ?? actor, Boolean(author));
  const feed = useProtocolPages(
    `bluesky-author-feed:${network.viewer}:${actor}:${tab}:${network.scope}`,
    async (cursor: string | null, signal) => {
      const params = new URLSearchParams({ actor, tab });
      if (cursor) {
        params.set("cursor", cursor);
      }
      return pageSchema.parse(
        await networkRequest(`/api/protocols/bluesky/profile?${params}`, {
          signal,
        })
      );
    },
    Boolean(author && network.ready)
  );
  const posts = [
    ...new Map(feed.items.map((post) => [post.id, post])).values(),
  ];
  return (
    <View style={{ backgroundColor: theme.containerBg, flex: 1 }}>
      <FlatList
        data={posts}
        keyExtractor={(post) => post.id}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <View className="gap-3">
            <SettingsButton
              label="Back"
              tone="gray"
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/")
              }
            />
            {profile.loading && !author ? (
              <ActivityIndicator color={theme.dividerText} />
            ) : null}
            {profile.error ? (
              <>
                <Text selectable style={{ color: theme.dividerText }}>
                  {profile.error}
                </Text>
                <SettingsButton
                  label="Retry profile"
                  tone="gray"
                  onPress={() => {
                    void profile.refetch();
                  }}
                />
              </>
            ) : null}
            {author ? (
              <>
                <ProfileHeader
                  external={author}
                  profile={authorProfile(author, follow.following)}
                  canFollow={!follow.pending}
                  canMessage={false}
                  isFollowing={follow.following}
                  isOwnProfile={false}
                  onFollow={() => {
                    if (user) {
                      void follow.toggle();
                    } else {
                      router.push("/login");
                    }
                  }}
                  onEdit={() => router.push("/settings")}
                  onMessage={() => {
                    void Linking.openURL(author.url);
                  }}
                />
                <FeedTabs tabs={TABS} active={tab} onChange={setTab} />
              </>
            ) : null}
            {follow.failed ? (
              <SettingsButton
                label="Retry follow state"
                tone="gray"
                onPress={() => {
                  void follow.toggle();
                }}
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => <BlueskyPostCard post={item} />}
        ListEmptyComponent={
          <>
            {feed.loading ? (
              <ActivityIndicator color={theme.dividerText} />
            ) : null}
            {!feed.loading && author && !feed.error ? (
              <Text className="p-6" style={{ color: theme.dividerText }}>
                No {tab} to show.
              </Text>
            ) : null}
          </>
        }
        ListFooterComponent={
          <View className="gap-3 p-4">
            {feed.error ? (
              <>
                <Text style={{ color: theme.dividerText }}>{feed.error}</Text>
                <SettingsButton
                  label="Retry posts"
                  tone="gray"
                  onPress={() => {
                    void (feed.hasMore ? feed.fetchNext() : feed.refresh());
                  }}
                />
              </>
            ) : null}
            {feed.hasMore ? (
              <SettingsButton
                disabled={feed.loadingMore}
                label={feed.loadingMore ? "Loading…" : "Load more"}
                onPress={() => {
                  void feed.fetchNext();
                }}
              />
            ) : null}
          </View>
        }
      />
    </View>
  );
}
