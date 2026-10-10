import {
  discoveryFleetFeed,
  followingFleetAvatars,
} from "@asm/ui/lib/home-feed-controls";
import { ChevronDown, Flame, Sparkles } from "lucide-react-native";
import type { LucideProps } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { authClient } from "@/features/auth/lib/auth-client";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import { MoreMenu } from "@/features/feed/components/more-menu";
import type { MenuAnchor } from "@/features/feed/components/more-menu";
import { feedCache } from "@/features/feed/state/feed-store";
import type { HomeTab } from "@/features/feed/state/tab-store";
import { fetchProfileUserList } from "@/features/profile/lib/profile-api";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

function FilledSparkles(props: LucideProps) {
  return <Sparkles {...props} fill={props.color ?? "currentColor"} />;
}

const peopleCache = new Map<
  string,
  {
    fetchedAt: number;
    people: Awaited<ReturnType<typeof fetchProfileUserList>>;
  }
>();

function FollowingAvatars({ userId }: { userId: string }) {
  const apiBase = getApiBaseUrl();
  const key = `${apiBase}:${userId}`;
  const [people, setPeople] = useState(
    () => peopleCache.get(key)?.people ?? []
  );
  const [, update] = useState(0);
  useEffect(
    () =>
      feedCache.subscribe((changed) => {
        if (!changed || changed.has(`following:${userId}`)) {
          update((value) => value + 1);
        }
      }),
    [userId]
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cached = peopleCache.get(key);
        const next =
          cached && Date.now() - cached.fetchedAt < 60_000
            ? cached.people
            : await fetchProfileUserList(userId, "following", {
                apiBase,
                cookie: await authClient.getCookie(),
              });
        if (!cancelled) {
          peopleCache.set(key, { fetchedAt: Date.now(), people: next });
          if (peopleCache.size > 4) {
            peopleCache.delete(peopleCache.keys().next().value ?? "");
          }
          setPeople(next);
        }
      } catch {
        // Cached avatars remain usable while the network is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, key, userId]);
  const avatars = followingFleetAvatars(
    feedCache.get(`following:${userId}`).pages.flat(),
    people
  );
  return (
    <View style={styles.stack} pointerEvents="none">
      {avatars.map((person, index) => (
        <View
          key={person.id}
          style={{ marginLeft: index ? -9 : 0, zIndex: 3 - index }}
        >
          <UserAvatar
            radius={6}
            size={22}
            seed={person.id}
            url={person.avatarUrl}
          />
        </View>
      ))}
    </View>
  );
}

export function HomeFeedControls({
  active,
  onChange,
  userId,
}: {
  active: HomeTab;
  onChange: (tab: HomeTab) => void;
  userId?: string;
}) {
  const { theme } = useAppTheme();
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [remembered, setRemembered] = useState<"personalized" | "trending">(
    "personalized"
  );
  const discovery = discoveryFleetFeed(active, remembered);
  if (
    (active === "personalized" || active === "trending") &&
    remembered !== active
  ) {
    setRemembered(active);
  }
  const tabs = [
    {
      label: discovery === "personalized" ? "For you" : "Trending",
      value: discovery,
    },
    { label: "Latest", value: "latest" },
    { label: "Following", value: "following" },
  ] as const;
  return (
    <View>
      <FeedTabs<HomeTab>
        active={active}
        tabs={tabs}
        onPressActive
        onChange={(value) => {
          if (value === discovery) {
            trigger.current?.measureInWindow((x, y, width, height) =>
              setAnchor({ height, width, x, y })
            );
          } else {
            onChange(value);
          }
        }}
        renderLabel={(tab, selected) => (
          <View
            ref={tab.value === discovery ? trigger : undefined}
            style={styles.label}
          >
            <Text
              style={{
                color: selected ? theme.inputText : theme.dividerText,
                fontFamily: selected ? "SofiaProBold" : "SofiaProMed",
                fontSize: 14,
              }}
            >
              {tab.label}
            </Text>
            {tab.value === discovery ? (
              <ChevronDown
                color={selected ? theme.inputText : theme.dividerText}
                size={14}
              />
            ) : null}
            {tab.value === "following" && selected && userId ? (
              <FollowingAvatars key={userId} userId={userId} />
            ) : null}
          </View>
        )}
      />
      <MoreMenu<{ type: "personalized" | "trending" }>
        align="start"
        anchor={anchor}
        minWidth={128}
        entries={(["personalized", "trending"] as const)
          .filter((value) => value !== active)
          .map((value) => ({
            action: { type: value },
            icon: value === "personalized" ? FilledSparkles : Flame,
            label: value === "personalized" ? "For you" : "Trending",
          }))}
        onClose={() => setAnchor(null)}
        onAction={({ type }) => {
          setRemembered(type);
          onChange(type);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { alignItems: "center", flexDirection: "row", gap: 5 },
  stack: { flexDirection: "row", marginLeft: 3 },
});
