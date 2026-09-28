// Web's JoinButton: the compact 3D pill reading Join / Joined / Requested.
// Ported 1:1 - the orange `btn-3d` gradient while the action is still available,
// the neutral `btn-3d-gray` once it is spent, an h-8 pill at px-3.5 with
// text-xs, and web's own toasts. Owners never see it (they cannot leave their
// own community) and the server enforces the same rule.
import { Pressable, StyleSheet, Text } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { useAppTheme } from "@/theme";

import type { CommunityMembership } from "../state/use-community-membership";

type JoinState = "active" | "idle" | "pending";

function joinStateOf(status: string | undefined): JoinState {
  if (status === "ACTIVE") {
    return "active";
  }
  if (status === "PENDING") {
    return "pending";
  }
  return "idle";
}

// Web resolves the label and the variant in one place before rendering; doing
// the same keeps the pill's colour and its text from ever disagreeing.
function joinLabel(state: JoinState): string {
  if (state === "active") {
    return "Joined";
  }
  if (state === "pending") {
    return "Requested";
  }
  return "Join";
}

function joinAccessibilityLabel(state: JoinState): string {
  if (state === "active") {
    return "Leave community";
  }
  if (state === "pending") {
    return "Cancel join request";
  }
  return "Join community";
}

export function CommunityJoinButton({
  isLoggedIn,
  membershipState,
  onRequireLogin,
  style,
}: {
  isLoggedIn: boolean;
  membershipState: CommunityMembership;
  onRequireLogin: () => void;
  style?: object;
}) {
  const { isDark } = useAppTheme();
  const { isOwner, pending, membership, toggle } = membershipState;

  if (isOwner) {
    return null;
  }

  const state = joinStateOf(membership?.status);
  const label = joinLabel(state);
  // Join is the orange primary; every settled state is the neutral pill, so the
  // control quiets down once the action is spent.
  const primary = state === "idle";

  return (
    <Pressable
      accessibilityLabel={joinAccessibilityLabel(state)}
      accessibilityRole="button"
      accessibilityState={{ busy: pending }}
      disabled={pending}
      onPress={() => {
        // A guest is sent to sign in rather than shown a dead control, which is
        // what web's useRequireAuth does on the same tap.
        if (!isLoggedIn) {
          onRequireLogin();
          return;
        }
        void toggle();
      }}
      style={style}
    >
      {({ pressed }) =>
        primary ? (
          <Gradient3D
            colors={pressed ? ORANGE_PRESSED : ORANGE_RESTING}
            radius={9999}
            shadows={pressed ? BTN_3D_ACTIVE : BTN_3D}
            style={[styles.pill, pressed && styles.pressed]}
          >
            <Text style={styles.labelPrimary}>{label}</Text>
          </Gradient3D>
        ) : (
          <Gradient3D
            colors={pressed ? GRAY_ACTIVE : grayResting(isDark)}
            radius={9999}
            shadows={pressed ? GRAY_ACTIVE_SHADOWS : grayShadows(isDark)}
            style={[styles.pill, pressed && styles.pressed]}
          >
            <Text style={styles.labelGray}>{label}</Text>
          </Gradient3D>
        )
      }
    </Pressable>
  );
}

// `.btn-3d` resting + `:active` and `.btn-3d-gray` light + dark, copied from
// packages/ui/styles/globals.css so both themes match the web control.
const ORANGE_RESTING = ["#ff9500", "#e65500"] as const;
const ORANGE_PRESSED = ["#e65500", "#d44a00"] as const;
const BTN_3D =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.6), 0 3px 5px rgba(0, 0, 0, 0.08), 0 8px 16px -4px rgba(0, 0, 0, 0.15)";
const BTN_3D_ACTIVE =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.18), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 0 0 rgba(255, 255, 255, 0), 0 1px 2px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.12)";

const grayResting = (isDark: boolean) =>
  isDark
    ? (["#4a4a4a", "#333333"] as const)
    : (["#f7f8fa", "#e4e7ec"] as const);
const grayShadows = (isDark: boolean) =>
  isDark
    ? "inset 0 0 0 1px rgba(255, 255, 255, 0.18), inset 0 1.5px 2px rgba(255, 255, 255, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.7), 0 1px 2px rgba(0, 0, 0, 0.2)"
    : "inset 0 0 0 1px rgba(255, 255, 255, 0.85), inset 0 1.5px 2px rgba(255, 255, 255, 0.95), 0 0 0 1px rgba(0, 0, 0, 0.1), 0 1px 1px rgba(0, 0, 0, 0.03), 0 2px 4px rgba(0, 0, 0, 0.06)";
const GRAY_ACTIVE = ["#dfe3e9", "#cdd2da"] as const;
const GRAY_ACTIVE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.6), inset 0 1px 3px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06)";

const styles = StyleSheet.create({
  labelGray: {
    color: "#1f2430",
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
    textShadowColor: "rgba(255, 255, 255, 0.7)",
    textShadowOffset: { height: 1, width: 0 },
  },
  labelPrimary: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { height: 1, width: 0 },
  },
  pill: {
    height: 32,
    paddingHorizontal: 14,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
});
