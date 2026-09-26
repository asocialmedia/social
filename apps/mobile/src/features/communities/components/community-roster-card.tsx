// The community roster, ported from web's `community-people.tsx` and
// `community-top-members.tsx`.
//
// Web groups the roster by role and lets a moderator approve a pending request
// or change a role in place. Both now have REST routes, so the native roster can
// do the same rather than being a read-only list.
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import {
  approveCommunityMember,
  fetchCommunityRoster,
  setCommunityMemberRole,
} from "../lib/communities-api";
import type {
  CommunityMember,
  CommunityMutationResult,
} from "../lib/communities-api";

// Web's grouping, in the same order. A member holding no role badge is a
// participant and is listed last.
const ROLE_ORDER = ["OWNER", "MODERATOR", "MEMBER", "PARTICIPANT"] as const;

const ROLE_LABELS: Record<string, string> = {
  MEMBER: "Members",
  MODERATOR: "Moderators",
  OWNER: "Owner",
  PARTICIPANT: "Participants",
};

function groupMembers(
  members: CommunityMember[]
): [string, CommunityMember[]][] {
  const buckets = new Map<string, CommunityMember[]>();
  for (const member of members) {
    const known = ROLE_ORDER as readonly string[];
    const role = known.includes(member.role) ? member.role : "PARTICIPANT";
    buckets.set(role, [...(buckets.get(role) ?? []), member]);
  }
  return ROLE_ORDER.filter((role) => buckets.has(role)).map((role) => [
    role,
    buckets.get(role) ?? [],
  ]);
}

export function CommunityRosterCard({
  canModerate,
  onRequireLogin,
  slug,
}: {
  canModerate: boolean;
  onRequireLogin: () => void;
  slug: string;
}) {
  const { theme } = useAppTheme();
  const { runWithInstallToken } = useInstall();
  const [members, setMembers] = useState<CommunityMember[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [showPending, setShowPending] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const options = useCallback(
    async () => ({
      apiBase: getApiBaseUrl(),
      cookie: await authClient.getCookie(),
    }),
    []
  );

  const load = useCallback(
    async (pending: boolean) => {
      const resolved = await options();
      const roster = await fetchCommunityRoster(slug, resolved, {
        badged: !pending,
        limit: 50,
        pending,
        sort: pending ? "role" : "aura",
      });
      if (!roster) {
        setMembers([]);
        return;
      }
      setMembers(roster.members);
      // A moderator sees the request count on the tab, as web does.
      if (canModerate && !pending) {
        const requests = await fetchCommunityRoster(slug, resolved, {
          limit: 100,
          pending: true,
        });
        setPendingCount(requests?.members.length ?? 0);
      }
    },
    [canModerate, options, slug]
  );

  useEffect(() => {
    // Loading the roster from the server is exactly what an effect is for; the
    // setState calls happen after the awaits inside load, not synchronously.
    // oxlint-disable-next-line react/set-state-in-effect -- async external sync
    void load(showPending);
  }, [load, showPending]);

  const act = async (
    userId: string,
    run: (resolved: ApiCallOptions) => Promise<CommunityMutationResult>,
    successTitle: string
  ) => {
    setBusyUserId(userId);
    const resolved = await options();
    const result = await runWithInstallToken(
      () => run(resolved),
      (value) => Boolean(value && value.kind === "install-token-required")
    );
    setBusyUserId(null);
    if (result === null) {
      return;
    }
    if (result.kind !== "success") {
      toast({
        description:
          result.kind === "error" ? result.message : "Couldn't do that",
        title: "That didn't work",
        variant: "destructive",
      });
      return;
    }
    toast({ description: "The roster has been updated.", title: successTitle });
    await load(showPending);
  };

  // The moderation control for one row: approve a pending request, demote a
  // moderator, or promote anyone else. Those are the three transitions web
  // offers from the same row, and they live together so the rules stay
  // readable next to each other.
  const memberAction = (member: CommunityMember, role: string) => {
    // The owner cannot be demoted, and a guest cannot moderate.
    if (!canModerate || role === "OWNER") {
      return null;
    }
    const busy = busyUserId === member.id;
    if (showPending) {
      return (
        <Pressable
          accessibilityLabel={`Approve ${member.username}`}
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            void act(
              member.id,
              (resolved) => approveCommunityMember(slug, member.id, resolved),
              "Approved"
            );
          }}
        >
          <Text style={[styles.action, { color: "#ff9500" }]}>Approve</Text>
        </Pressable>
      );
    }
    const promoting = role !== "MODERATOR";
    return (
      <Pressable
        accessibilityLabel={`Make ${member.username} a ${
          promoting ? "moderator" : "member"
        }`}
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          void act(
            member.id,
            (resolved) =>
              setCommunityMemberRole(
                slug,
                member.id,
                promoting ? "MODERATOR" : "MEMBER",
                resolved
              ),
            "Role Updated"
          );
        }}
      >
        <Text
          style={[
            styles.action,
            { color: promoting ? "#ff9500" : theme.dividerText },
          ]}
        >
          {promoting ? "Make moderator" : "Make member"}
        </Text>
      </Pressable>
    );
  };

  // The loading, empty and grouped states resolve together so they cannot drift
  // apart as the roster grows a moderation path.
  const renderMembers = () => {
    if (members === null) {
      return <ActivityIndicator color="#ff9500" />;
    }
    if (members.length === 0) {
      return (
        <Text style={[styles.note, { color: theme.dividerText }]}>
          {showPending ? "No pending requests." : "No members to show yet."}
        </Text>
      );
    }
    return groupMembers(members).map(([role, rows]) => (
      <View key={role} style={styles.group}>
        <Text style={[styles.groupLabel, { color: theme.dividerText }]}>
          {ROLE_LABELS[role] ?? role}
        </Text>
        {rows.map((member) => (
          <View key={member.id} style={styles.member}>
            <UserAvatar
              size={36}
              url={
                member.avatarUrl
                  ? `${getApiBaseUrl()}${member.avatarUrl}`
                  : null
              }
            />
            <View style={styles.memberCopy}>
              <Text
                numberOfLines={1}
                style={[styles.memberName, { color: theme.inputText }]}
              >
                {member.displayName || member.username}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.note, { color: theme.dividerText }]}
              >
                @{member.username} · {member.aura.toLocaleString()} aura
              </Text>
            </View>
            {memberAction(member, role)}
          </View>
        ))}
      </View>
    ));
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
      ]}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: theme.inputText }]}>People</Text>
        {canModerate && pendingCount > 0 ? (
          <Pressable
            accessibilityLabel={
              showPending
                ? "Show the member list"
                : `Show ${pendingCount} pending requests`
            }
            accessibilityRole="button"
            onPress={() => {
              setShowPending((value) => !value);
            }}
          >
            <Text style={[styles.tab, { color: "#ff9500" }]}>
              {showPending ? "People" : `Requests (${pendingCount})`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {renderMembers()}
      {canModerate ? null : (
        <Pressable
          accessibilityLabel="Join to see the full roster"
          accessibilityRole="button"
          onPress={onRequireLogin}
        >
          <Text style={[styles.note, { color: theme.dividerText }]}>
            Join to see everyone and the requests.
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  action: { fontFamily: "SofiaProMed", fontSize: 12 },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
  },
  group: { gap: 8 },
  groupLabel: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  head: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  member: { alignItems: "center", flexDirection: "row", gap: 10 },
  memberCopy: { flex: 1, minWidth: 0 },
  memberName: { fontFamily: "SofiaProMed", fontSize: 14 },
  note: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 17 },
  tab: { fontFamily: "SofiaProMed", fontSize: 13 },
  title: { fontFamily: "SofiaProBold", fontSize: 16 },
});
