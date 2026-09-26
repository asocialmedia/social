// Web's CommunityNotifyButton: a round 32px `icon-btn-3d` beside Join, showing a
// filled Bell when subscribed and a muted BellOff when not, with the active
// state being the primary text colour (`.icon-btn-3d-active` is exactly
// `color: hsl(var(--primary))` in both themes). A round icon button rather than a
// second labelled pill, so it reads as secondary to the primary Join action.
import { Bell, BellOff } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { iconButton, pressedPill } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

import type { CommunityMembership } from "../state/use-community-membership";

export function CommunityNotifyButton({
  isLoggedIn,
  membershipState,
  onRequireLogin,
}: {
  isLoggedIn: boolean;
  membershipState: CommunityMembership;
  onRequireLogin: () => void;
}) {
  const { isDark } = useAppTheme();
  const { pending, setSubscribed, subscribed } = membershipState;
  const resting = iconButton(isDark);
  const pressedTone = pressedPill(isDark);
  // Web's active class is a pure colour swap; the bell keeps the recessed chip
  // and simply takes the primary hue.
  const iconColor = subscribed ? "#ff5a00" : resting.color;

  return (
    <Pressable
      accessibilityLabel={
        subscribed
          ? "Turn off notifications for this community"
          : "Get notified about new posts in this community"
      }
      accessibilityRole="button"
      accessibilityState={{ busy: pending, checked: subscribed }}
      disabled={pending}
      hitSlop={6}
      onPress={() => {
        if (!isLoggedIn) {
          onRequireLogin();
          return;
        }
        void setSubscribed(!subscribed);
      }}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.chip,
            {
              backgroundColor: resting.background,
              boxShadow: resting.shadows,
            },
            pressed && styles.pressed,
          ]}
        >
          {pressed ? (
            <Gradient3D
              colors={pressedTone.gradient}
              radius={9999}
              shadows={pressedTone.shadows}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          {subscribed ? (
            <Bell color={iconColor} fill={iconColor} size={16} />
          ) : (
            <BellOff color={iconColor} size={16} />
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    borderRadius: 9999,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
});
