// Native port of web's `ExternalFollowingList` (protocols/external-following-list.tsx):
// the "Bluesky accounts followed in ASM" card that sits under the Bluesky
// connection card on the Account tab. It reads and edits the same
// /api/protocols/bluesky/follows endpoint and refreshes with the follow revision
// store, so an unfollow here and a follow anywhere else stay in step.
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { toast } from "@/components/feedback/toast";
import { useSessionContext } from "@/features/auth/state/session";
import { FeedErrorState } from "@/features/feed/components/feed-error-state";
import { useExternalFollowRevision } from "@/features/feed/state/use-external-follow";
import {
  SettingsButton,
  SettingsCard,
} from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

import { networkRequest } from "../lib/network-api";

const authorsSchema = z.object({
  authors: z
    .array(
      z.object({
        did: z.string(),
        displayName: z.string(),
        handle: z.string(),
        status: z.string(),
      })
    )
    .max(100),
});
type FollowedAuthor = z.infer<typeof authorsSchema>["authors"][number];

type LoadState = "error" | "loading" | "success";

export function ExternalFollowingCard() {
  const { user } = useSessionContext();
  const { theme } = useAppTheme();
  const router = useRouter();
  const viewer = user?.id ?? "guest";
  const revision = useExternalFollowRevision(
    (state) => state.revisions[viewer] ?? 0
  );
  const [authors, setAuthors] = useState<FollowedAuthor[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [retrying, setRetrying] = useState(false);
  const [removingDid, setRemovingDid] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!user) {
        return;
      }
      try {
        const next = authorsSchema.parse(
          await networkRequest("/api/protocols/bluesky/follows", { signal })
        );
        if (!signal?.aborted) {
          setAuthors(next.authors);
          setLoadState("success");
        }
      } catch {
        if (!signal?.aborted) {
          setLoadState("error");
        }
      }
    },
    [user]
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void load(controller.signal);
      }
    });
    return () => controller.abort();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- revision re-reads after a follow changes elsewhere
  }, [load, revision]);

  const retry = async () => {
    setRetrying(true);
    await load();
    setRetrying(false);
  };

  const unfollow = async (did: string) => {
    if (!user || removingDid) {
      return;
    }
    setRemovingDid(did);
    try {
      await networkRequest("/api/protocols/bluesky/follows", {
        body: JSON.stringify({ active: false, actor: did }),
        method: "POST",
      });
      setAuthors((current) => current.filter((author) => author.did !== did));
      toast({
        description: "Removed from your asocialmedia follows.",
        title: "Unfollowed",
      });
      useExternalFollowRevision.getState().changed(user.id);
    } catch {
      toast({
        title: "Couldn't unfollow. Please try again.",
        variant: "destructive",
      });
    }
    setRemovingDid(null);
  };

  if (!user) {
    return null;
  }

  return (
    // Web: `surface-3d space-y-3 rounded-xl p-4`.
    <SettingsCard padded={false} style={styles.card}>
      <Text style={[styles.title, { color: theme.inputText }]}>
        Bluesky accounts followed in ASM
      </Text>
      <Text style={[styles.copy, { color: theme.dividerText }]}>
        No linked Bluesky account required. These follows stay in ASM, including
        when you disconnect Bluesky.
      </Text>
      {loadState === "loading" ? (
        <Text style={[styles.status, { color: theme.dividerText }]}>
          Loading followed accounts…
        </Text>
      ) : null}
      {loadState === "error" ? (
        <FeedErrorState
          compact
          isRetrying={retrying}
          message="Couldn't load followed Bluesky accounts."
          onRetry={() => {
            void retry();
          }}
        />
      ) : null}
      {loadState === "success" && authors.length === 0 ? (
        <Text style={[styles.status, { color: theme.dividerText }]}>
          Visit a Bluesky profile in ASM and choose Follow.
        </Text>
      ) : null}
      {authors.map((author) => (
        <View key={author.did} style={styles.row}>
          <Pressable
            accessibilityRole="link"
            onPress={() =>
              router.push({
                params: { actor: author.did },
                pathname: "/external-profile",
              })
            }
            style={styles.rowCopy}
          >
            <Text
              numberOfLines={1}
              style={[styles.name, { color: theme.inputText }]}
            >
              {author.displayName || author.handle}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.handle, { color: theme.dividerText }]}
            >
              @{author.handle}
              {author.status === "active" ? "" : ` · ${author.status}`}
            </Text>
          </Pressable>
          <SettingsButton
            disabled={removingDid !== null}
            label={removingDid === author.did ? "Removing…" : "Unfollow"}
            onPress={() => {
              void unfollow(author.did);
            }}
            size="sm"
          />
        </View>
      ))}
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, gap: 12, padding: 16 },
  copy: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 17 },
  handle: { fontFamily: "SofiaProReg", fontSize: 12 },
  name: { fontFamily: "SofiaProReg", fontSize: 14 },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  rowCopy: { flex: 1, minWidth: 0 },
  status: { fontFamily: "SofiaProReg", fontSize: 14 },
  title: { fontFamily: "SofiaProBold", fontSize: 16 },
});
