// Native port of web's CommunityRequestNotificationActions
// (components/communities/page/community-join-requests.tsx): under a
// COMMUNITY_JOIN_REQUEST row, a moderator who can still decide sees Accept and
// Decline; a request that was already handled says so; anyone else sees
// nothing. The status is read fresh every mount, like web's staleTime 0.
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { toast } from "@/components/feedback/toast";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_BUTTON_SHADOWS,
  ORANGE_GRADIENT,
} from "@/components/surface/recipes";
import {
  NetworkRequestError,
  networkRequest,
} from "@/features/network/lib/network-api";
import { useProtocolResource } from "@/features/network/state/use-protocol-resource";
import { useAppTheme } from "@/theme";

const statusSchema = z.object({
  canDecide: z.boolean(),
  pending: z.boolean(),
});
const decisionSchema = z.object({ applied: z.boolean().optional() });

async function readRequestStatus(path: string, signal: AbortSignal) {
  try {
    return statusSchema.parse(await networkRequest(path, { signal }));
  } catch (error) {
    // Web treats 403 and 404 as "nothing for this viewer to decide".
    if (
      error instanceof NetworkRequestError &&
      (error.status === 403 || error.status === 404)
    ) {
      return { canDecide: false, pending: false };
    }
    throw error;
  }
}

export function CommunityRequestActions({
  requestId,
  slug,
}: {
  requestId: string;
  slug: string;
}) {
  const { theme } = useAppTheme();
  const [deciding, setDeciding] = useState(false);
  const path = `/api/communities/${encodeURIComponent(slug)}/membership-requests/${encodeURIComponent(requestId)}`;
  // Zero stale time, like web's staleTime 0: every mount re-reads the status.
  const resource = useProtocolResource(
    `community-request-status:${path}`,
    (signal) => readRequestStatus(path, signal),
    true,
    0
  );
  const load = resource.refetch;
  const status = resource.data;

  const decide = async (decision: "approve" | "decline") => {
    setDeciding(true);
    try {
      const result = decisionSchema.parse(
        await networkRequest(path, {
          body: JSON.stringify({ decision }),
          method: "PATCH",
        })
      );
      let title = "Request already resolved";
      if (result.applied) {
        title = decision === "approve" ? "Member approved" : "Request declined";
      }
      toast({ title });
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
    await load();
  };

  if (resource.error && !status) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void load();
        }}
        style={styles.ghost}
      >
        <Text style={[styles.ghostText, { color: theme.inputText }]}>
          Retry request status
        </Text>
      </Pressable>
    );
  }
  if (!status) {
    return (
      <Text style={[styles.note, { color: theme.dividerText }]}>
        Checking request…
      </Text>
    );
  }
  if (!status.canDecide) {
    return null;
  }
  if (!status.pending) {
    return (
      <Text style={[styles.note, { color: theme.dividerText }]}>
        This request is no longer pending.
      </Text>
    );
  }
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        disabled={deciding}
        onPress={() => {
          void decide("approve");
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
          void decide("decline");
        }}
        style={[styles.ghost, deciding && styles.disabled]}
      >
        <Text style={[styles.ghostText, { color: theme.inputText }]}>
          Decline
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  accept: {
    minHeight: 44,
    paddingHorizontal: 16,
  },
  acceptText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 13,
  },
  disabled: { opacity: 0.5 },
  ghost: {
    alignItems: "center",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  ghostText: {
    fontFamily: "SofiaProMed",
    fontSize: 13,
  },
  note: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  // Web's `px-4 pb-3 pl-[4.25rem]`: the buttons line up with the row's text.
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 12,
    paddingLeft: 68,
    paddingRight: 16,
  },
});
