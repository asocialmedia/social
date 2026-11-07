// Native port of web CommunityJoinRequests
// (components/communities/page/community-join-requests.tsx): a "Join requests"
// pill with the pending count, opening a dialog where staff accept or decline
// each request. The list refreshes every 30 seconds while the dialog is open,
// and a `?requests=1` link opens it straight away, like web's openOnLink.
import { useRouter } from "expo-router";
import { Users } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
import { DialogPanel } from "@/components/surface/dialog-panel";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_BUTTON_SHADOWS,
  ORANGE_GRADIENT,
  metaChip,
} from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

import type {
  CommunityJoinRequestPage,
  CommunityRequestDecision,
} from "../lib/community-requests-api";
import {
  communityDecisionTitle,
  decideCommunityJoinRequest,
  fetchCommunityJoinRequests,
  mergeCommunityRequestPages,
} from "../lib/community-requests-api";

const OPEN_REFRESH_MS = 30_000;

type LoadState = "error" | "idle" | "loading" | "ready";

export function CommunityJoinRequests({
  initiallyOpen = false,
  onDecided,
  slug,
}: {
  initiallyOpen?: boolean;
  // Called after a decision lands, so the page can refresh its member count.
  onDecided?: () => void;
  slug: string;
}) {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();
  const chip = metaChip(isDark);
  const [open, setOpen] = useState(initiallyOpen);
  const [pages, setPages] = useState<CommunityJoinRequestPage[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const generation = useRef(0);

  // Reloads the first page. Older pages are dropped, matching a fresh
  // infinite-query refetch that starts from the head of the queue.
  const reload = useCallback(async () => {
    generation.current += 1;
    const token = generation.current;
    setState((current) => (current === "ready" ? "ready" : "loading"));
    try {
      const page = await fetchCommunityJoinRequests(slug, null);
      if (generation.current === token) {
        setPages([page]);
        setDecided(new Set());
        setState("ready");
      }
    } catch {
      if (generation.current === token) {
        setState("error");
      }
    }
  }, [slug]);

  // The first load mirrors reload without its synchronous loading flip; the
  // state already starts at "loading", so the effect only writes after await.
  useEffect(() => {
    generation.current += 1;
    const token = generation.current;
    void (async () => {
      try {
        const page = await fetchCommunityJoinRequests(slug, null);
        if (generation.current === token) {
          setPages([page]);
          setDecided(new Set());
          setState("ready");
        }
      } catch {
        if (generation.current === token) {
          setState("error");
        }
      }
    })();
    return () => {
      generation.current += 1;
    };
  }, [slug]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = setInterval(() => {
      if (AppState.currentState === "active") {
        void reload();
      }
    }, OPEN_REFRESH_MS);
    return () => clearInterval(timer);
  }, [open, reload]);

  const loadMore = async () => {
    const cursor = pages.at(-1)?.nextCursor;
    if (!cursor || loadingMore) {
      return;
    }
    const token = generation.current;
    setLoadingMore(true);
    try {
      const page = await fetchCommunityJoinRequests(slug, cursor);
      if (generation.current === token) {
        setPages((current) => [...current, page]);
      }
    } catch {
      toast({
        title: "Couldn't load more requests",
        variant: "destructive",
      });
    }
    setLoadingMore(false);
  };

  const decide = async (
    requestId: string,
    decision: CommunityRequestDecision
  ) => {
    setDeciding(true);
    try {
      const result = await decideCommunityJoinRequest(
        slug,
        requestId,
        decision
      );
      toast({ title: communityDecisionTitle(decision, result.applied) });
      setDecided((current) => new Set([...current, requestId]));
      onDecided?.();
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Couldn't review this request",
        title: "Couldn't review request",
        variant: "destructive",
      });
    }
    setDeciding(false);
    void reload();
  };

  const { requests, total } = mergeCommunityRequestPages(pages, decided);
  const hasNextPage = Boolean(pages.at(-1)?.nextCursor);

  return (
    <>
      <Pressable
        accessibilityLabel={
          total ? `Join requests, ${total} pending` : "Join requests"
        }
        accessibilityRole="button"
        onPress={() => {
          setOpen(true);
          void reload();
        }}
        style={({ pressed }) => [
          styles.trigger,
          pressed && { backgroundColor: chip.background },
        ]}
      >
        <Users color={theme.inputText} size={16} />
        <Text style={[styles.triggerText, { color: theme.inputText }]}>
          Join requests
        </Text>
        {total ? (
          <View
            style={[
              styles.countChip,
              {
                backgroundColor: chip.background,
                borderColor: chip.border,
                boxShadow: chip.shadows,
              },
            ]}
          >
            <Text style={[styles.countText, { color: theme.inputText }]}>
              {total}
            </Text>
          </View>
        ) : null}
      </Pressable>
      {open ? (
        <DialogPanel
          busy={deciding}
          description={`Review who can access a/${slug}. Accepted members can read posts and join community chat.`}
          onClose={() => setOpen(false)}
          title={`Join requests${total === undefined ? "" : ` (${total})`}`}
        >
          {state === "loading" && !pages.length ? (
            <Text style={[styles.note, { color: theme.inputText }]}>
              Loading requests…
            </Text>
          ) : null}
          {state === "error" ? (
            <View accessibilityRole="alert" style={styles.errorRow}>
              <Text style={[styles.body, { color: theme.inputText }]}>
                Couldn't load requests.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void reload();
                }}
                style={styles.ghost}
              >
                <Text style={[styles.ghostText, { color: theme.inputText }]}>
                  Retry
                </Text>
              </Pressable>
            </View>
          ) : null}
          {total === 0 ? (
            <Text style={[styles.note, { color: theme.dividerText }]}>
              You're all caught up. No pending requests.
            </Text>
          ) : null}
          {requests.map((request, index) =>
            request.user ? (
              <View
                key={request.id}
                style={[
                  styles.requestRow,
                  index > 0 && {
                    borderTopColor: theme.cardBorder,
                    borderTopWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="link"
                  onPress={() => {
                    const username = request.user?.username;
                    if (!username) {
                      return;
                    }
                    setOpen(false);
                    router.push({
                      params: { username },
                      pathname: "/users/[username]",
                    });
                  }}
                  style={styles.identity}
                >
                  <UserAvatar
                    seed={request.user.id}
                    size={40}
                    url={request.user.avatarUrl}
                    username={request.user.username}
                  />
                  <View style={styles.identityText}>
                    <Text
                      numberOfLines={1}
                      style={[styles.name, { color: theme.inputText }]}
                    >
                      {request.user.displayName || request.user.username}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.handle, { color: theme.dividerText }]}
                    >
                      @{request.user.username}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={deciding}
                    onPress={() => {
                      void decide(request.id, "approve");
                    }}
                    style={({ pressed }) => [
                      deciding && styles.disabled,
                      { transform: [{ translateY: pressed ? 1 : 0 }] },
                    ]}
                  >
                    <Gradient3D
                      colors={ORANGE_GRADIENT}
                      radius={12}
                      shadows={ORANGE_BUTTON_SHADOWS}
                      style={styles.accept}
                    >
                      <Text style={styles.acceptText}>Accept</Text>
                    </Gradient3D>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={deciding}
                    onPress={() => {
                      void decide(request.id, "decline");
                    }}
                    style={[styles.ghost, deciding && styles.disabled]}
                  >
                    <Text
                      style={[styles.ghostText, { color: theme.inputText }]}
                    >
                      Decline
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null
          )}
          {hasNextPage ? (
            <Pressable
              accessibilityRole="button"
              disabled={loadingMore}
              onPress={() => {
                void loadMore();
              }}
              style={[styles.ghost, styles.loadMore]}
            >
              <Text style={[styles.ghostText, { color: theme.inputText }]}>
                {loadingMore ? "Loading…" : "Load more requests"}
              </Text>
            </Pressable>
          ) : null}
        </DialogPanel>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  accept: { minHeight: 44, paddingHorizontal: 16 },
  acceptText: { color: "#ffffff", fontFamily: "SofiaProBold", fontSize: 13 },
  actions: { flexDirection: "row", gap: 8 },
  body: { fontFamily: "SofiaProReg", fontSize: 14 },
  countChip: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 20,
    paddingHorizontal: 6,
  },
  countText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  disabled: { opacity: 0.5 },
  errorRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    paddingVertical: 16,
  },
  ghost: {
    alignItems: "center",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  ghostText: { fontFamily: "SofiaProMed", fontSize: 13 },
  handle: { fontFamily: "SofiaProReg", fontSize: 12 },
  identity: {
    alignItems: "center",
    flexDirection: "row",
    flexGrow: 1,
    flexShrink: 1,
    gap: 12,
    minWidth: 160,
  },
  identityText: { flexShrink: 1, minWidth: 0 },
  loadMore: { alignSelf: "stretch", marginVertical: 12 },
  name: { fontFamily: "SofiaProMed", fontSize: 14 },
  note: { fontFamily: "SofiaProReg", fontSize: 14, paddingVertical: 24 },
  requestRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingVertical: 12,
  },
  trigger: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  triggerText: { fontFamily: "SofiaProMed", fontSize: 13 },
});
