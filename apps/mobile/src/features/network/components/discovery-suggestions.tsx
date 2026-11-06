import type { RecommendedAccount } from "@asm/protocols/discovery";
import { useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { mutateExploreFollow } from "@/features/explore/lib/explore-api";
import { useExternalFollow } from "@/features/feed/state/use-external-follow";
import { SettingsButton } from "@/features/settings/components/settings-ui";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { networkRequest } from "../lib/network-api";
import { nativeNetworkPath } from "../lib/network-paths";
import { useDiscoverySuggestions } from "../state/use-discovery-suggestions";
import { invalidateProtocolResources } from "../state/use-protocol-resource";

function SuggestedAccount({
  account,
  onOpen,
  onDismiss,
}: {
  account: RecommendedAccount;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { theme } = useAppTheme();
  const { user } = useSessionContext();
  const router = useRouter();
  const external = useExternalFollow(account.id, account.source === "bluesky");
  const [following, setFollowing] = useState(account.following);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const toggle = async () => {
    if (!user) {
      router.push("/login");
      return;
    }
    if (account.source === "bluesky") {
      await external.toggle();
      return;
    }
    if (pending) {
      return;
    }
    setPending(true);
    setErrorMessage(null);
    try {
      const next = await mutateExploreFollow(account.id, !following, {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      });
      setFollowing(next.isFollowedByUser);
      invalidateProtocolResources("discovery-suggestions:");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Couldn't follow"
      );
    }
    setPending(false);
  };
  const selected =
    account.source === "bluesky" ? external.following : following;
  return (
    <View className="gap-2 py-3">
      <Pressable
        accessibilityRole="link"
        onPress={onOpen}
        className="flex-row items-center gap-3"
      >
        <UserAvatar size={40} url={account.avatarUrl} seed={account.id} />
        <View className="flex-1">
          <Text style={{ color: theme.inputText }}>
            {account.displayName}{" "}
            {account.source === "bluesky" ? "· Bluesky" : ""}
          </Text>
          <Text style={{ color: theme.dividerText }}>
            @{account.handle} · {account.reason}
          </Text>
        </View>
      </Pressable>
      <View className="flex-row flex-wrap gap-2">
        <SettingsButton
          size="sm"
          label={selected ? "Following" : "Follow"}
          disabled={pending || external.pending}
          onPress={() => {
            void toggle();
          }}
        />
        <SettingsButton
          size="sm"
          tone="gray"
          label="Dismiss suggestion"
          onPress={onDismiss}
        />
      </View>
      {errorMessage ? (
        <Text selectable style={{ color: theme.dividerText }}>
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );
}

export function DiscoverySuggestions({
  onQuery,
  onClose,
  enabled = true,
  showInterests = false,
}: {
  onQuery?: (query: string) => void;
  onClose?: () => void;
  enabled?: boolean;
  showInterests?: boolean;
}) {
  const query = useDiscoverySuggestions(enabled);
  const router = useRouter();
  const { theme } = useAppTheme();
  const [hidden, setHidden] = useState<{ scope: string; ids: string[] }>({
    ids: [],
    scope: "",
  });
  const scope = `${query.network.viewer}:${query.network.scope}`;
  const interests =
    query.network.settings.preferences.profiles.find(
      (profile) =>
        profile.id === query.network.settings.preferences.activeProfileId
    )?.interests ?? [];
  const open = (href: string) => {
    const path = nativeNetworkPath(href);
    if (path) {
      onClose?.();
      router.push(path as Href);
    }
  };
  const dismiss = async (account: RecommendedAccount) => {
    const key = `${account.source}:${account.id}`;
    try {
      if (query.network.viewer !== "guest" && account.source === "asm") {
        await networkRequest("/api/users/suggested/dismiss", {
          body: JSON.stringify({
            profileId:
              query.data?.profileId ??
              query.network.settings.preferences.activeProfileId,
            source: account.source,
            userId: account.id,
          }),
          method: "POST",
        });
      }
      setHidden((current) => ({
        ids: [...(current.scope === scope ? current.ids : []), key],
        scope,
      }));
    } catch {
      // Keep the suggestion visible if a durable dismissal could not be saved.
    }
  };
  return (
    <View className="gap-3 p-4">
      {showInterests ? (
        <>
          <Text style={{ color: theme.inputText }}>Your interests</Text>
          <View className="flex-row flex-wrap gap-2">
            {interests.map((topic) => (
              <SettingsButton
                key={topic}
                size="sm"
                tone="gray"
                label={topic}
                onPress={() => onQuery?.(topic)}
              />
            ))}
            {interests.length ? null : (
              <SettingsButton
                size="sm"
                tone="gray"
                label="Choose interests"
                onPress={() => open("/settings?tab=network&section=content")}
              />
            )}
          </View>
          {query.network.settings.persona.relatedInterests.length ? (
            <View className="gap-2">
              <Text style={{ color: theme.dividerText }}>
                Explore related topics
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {query.network.settings.persona.relatedInterests
                  .slice(0, 12)
                  .map((topic) => (
                    <SettingsButton
                      key={topic}
                      size="sm"
                      tone="gray"
                      label={topic}
                      onPress={() => onQuery?.(topic)}
                    />
                  ))}
              </View>
            </View>
          ) : null}
        </>
      ) : null}
      <Text className="font-semibold" style={{ color: theme.inputText }}>
        Who to follow
      </Text>
      {query.loading && !query.data ? (
        <ActivityIndicator color={theme.dividerText} />
      ) : null}
      {query.error ? (
        <Text selectable style={{ color: theme.dividerText }}>
          {query.error}
        </Text>
      ) : null}
      {query.data?.accounts
        .filter(
          (account) =>
            hidden.scope !== scope ||
            !hidden.ids.includes(`${account.source}:${account.id}`)
        )
        .map((account) => (
          <SuggestedAccount
            key={`${query.network.scope}:${account.source}:${account.id}`}
            account={account}
            onOpen={() => open(account.href)}
            onDismiss={() => {
              void dismiss(account);
            }}
          />
        ))}
      {query.data?.accounts.length === 0 ? (
        <Text style={{ color: theme.dividerText }}>
          No account suggestions for this profile yet.
        </Text>
      ) : null}
      {showInterests
        ? query.data?.posts.map((post) => (
            <SettingsButton
              key={`${post.source}:${post.id}`}
              tone="gray"
              label={`${post.displayName} · ${post.reason}`}
              onPress={() => open(post.href)}
            />
          ))
        : null}
      {query.data?.partial ? (
        <Text style={{ color: theme.dividerText }}>
          Some networks are unavailable. Available suggestions are shown.
        </Text>
      ) : null}
      <SettingsButton
        tone="gray"
        label="Refresh suggestions"
        disabled={query.loading}
        onPress={() => {
          setHidden({ ids: [], scope });
          void query.refetch();
        }}
      />
    </View>
  );
}
