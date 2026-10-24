import {
  discoveryFeedPress,
  followingFleetAvatars,
  homeFeedTabs,
} from "@asm/ui/lib/home-feed-controls";
import type { DiscoveryFleetFeed } from "@asm/ui/lib/home-feed-controls";
import { ChevronDown, Flame, Sparkles } from "lucide-react-native";
import type { LucideProps } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import type { ViewInstance } from "react-native";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { authClient } from "@/features/auth/lib/auth-client";
import { FeedSourceMenu } from "@/features/feed/components/feed-source-menu";
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

function FilledFlame(props: LucideProps) {
  return <Flame {...props} fill={props.color ?? "currentColor"} />;
}

const peopleCache = new Map<
  string,
  {
    fetchedAt: number;
    people: Awaited<ReturnType<typeof fetchProfileUserList>>;
  }
>();

function FollowingAvatar({
  person,
  index,
}: {
  person: ReturnType<typeof followingFleetAvatars>[number];
  index: number;
}) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withTiming(1, { duration: 180 + index * 35 }));
  }, [index, progress]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: reducedMotion ? 0 : (1 - progress.get()) * 6 }],
  }));
  return (
    <Animated.View
      testID={`home-following-avatar-${person.id}`}
      style={[{ marginLeft: index ? -9 : 0, zIndex: 3 - index }, animatedStyle]}
    >
      <UserAvatar
        radius={6}
        size={22}
        seed={person.id}
        url={person.avatarUrl}
      />
    </Animated.View>
  );
}

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
        <FollowingAvatar key={person.id} person={person} index={index} />
      ))}
    </View>
  );
}

export function HomeFeedControls({
  active,
  discovery,
  onChange,
  userId,
}: {
  active: HomeTab;
  discovery: DiscoveryFleetFeed;
  onChange: (tab: HomeTab) => void;
  userId?: string;
}) {
  const { theme } = useAppTheme();
  const trigger = useRef<ViewInstance>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [discoveryLabelX, setDiscoveryLabelX] = useState(0);
  const [discoveryTextLayouts, setDiscoveryTextLayouts] = useState<
    Partial<Record<DiscoveryFleetFeed, { x: number; width: number }>>
  >({});
  const discoveryText = discoveryTextLayouts[discovery];
  const tabs = homeFeedTabs(discovery);
  return (
    <View style={{ alignItems: "center", flexDirection: "row" }}>
      <View style={{ flex: 1 }}>
        <FeedTabs<HomeTab>
          active={active}
          tabs={tabs}
          onPressActive
          indicatorLabelLayout={(tab) => {
            if (tab.value !== discovery) {
              return;
            }
            if (!discoveryText) {
              return null;
            }
            return {
              width: discoveryText.width,
              x: discoveryLabelX + discoveryText.x,
            };
          }}
          indicatorWidth={(tab, width) => {
            if (tab.value === discovery) {
              return width * 0.6;
            }
            return tab.value === "following" ? Math.max(48, width * 0.6) : 24;
          }}
          onChange={(value) => {
            if (value === discovery) {
              const action = discoveryFeedPress(active, discovery);
              if (action.type === "navigate") {
                onChange(action.feed);
                return;
              }
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
              onLayout={(event) => {
                if (tab.value === discovery) {
                  setDiscoveryLabelX(event.nativeEvent.layout.x);
                }
              }}
              style={styles.label}
            >
              <Text
                testID={
                  tab.value === discovery ? "home-discovery-label" : undefined
                }
                onLayout={(event) => {
                  if (tab.value !== discovery) {
                    return;
                  }
                  const { width, x } = event.nativeEvent.layout;
                  setDiscoveryTextLayouts((current) =>
                    current[discovery]?.width === width &&
                    current[discovery]?.x === x
                      ? current
                      : { ...current, [discovery]: { width, x } }
                  );
                }}
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
      </View>
      <FeedSourceMenu following={active === "following"} />
      <MoreMenu<{ type: "personalized" | "trending" }>
        align="start"
        anchor={anchor}
        minWidth={128}
        entries={(["personalized", "trending"] as const)
          .filter((value) => value !== discovery)
          .map((value) => ({
            action: { type: value },
            icon: value === "personalized" ? FilledSparkles : FilledFlame,
            label: value === "personalized" ? "For you" : "Trending",
          }))}
        onClose={() => setAnchor(null)}
        onAction={({ type }) => {
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
