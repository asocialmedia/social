// Native port of web's CommunityRoleBadge
// (apps/web/src/components/communities/card/community-role-badge.tsx).
// Web renders the badge art at a 3:1 ratio (60x20) with a tooltip naming the
// role and the community; native renders the same art at the same ratio and
// folds the tooltip copy into the accessibility label, since there is no
// hover on a phone.
import { Image } from "expo-image";
import { memo } from "react";
import { StyleSheet, View } from "react-native";

import {
  COMMUNITY_BADGE_ART,
  COMMUNITY_BADGE_META,
} from "../lib/community-role-badge";
import type { CommunityBadgedRole } from "../lib/community-role-badge";

function CommunityRoleBadge({
  communityName,
  roleValue,
}: {
  communityName?: string;
  roleValue: CommunityBadgedRole;
}) {
  const meta = COMMUNITY_BADGE_META[roleValue];
  const label = communityName
    ? `${meta.label} of a/${communityName}. ${meta.description}`
    : `${meta.label}. ${meta.description}`;
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="image"
      style={styles.badge}
    >
      <Image
        contentFit="contain"
        source={COMMUNITY_BADGE_ART[roleValue]}
        style={styles.art}
      />
    </View>
  );
}

// Web's `h-5 w-15`: 20pt tall at the source art's 3:1 ratio.
const styles = StyleSheet.create({
  art: { height: "100%", width: "100%" },
  badge: { height: 20, width: 60 },
});

export default memo(CommunityRoleBadge);
