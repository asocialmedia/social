import { Flame, Users, Zap } from "lucide-react-native";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { SHOWS_SCROLL_INDICATOR } from "@/lib/layout/scroll-indicator";
import { useAppTheme } from "@/theme";

import type { CommunityData } from "../lib/communities-api";
import { COMMUNITY_PAGE_GUTTER } from "../lib/community-discovery";
import { CommunityCard } from "./community-card";

export function CommunityRail({
  auras,
  communities,
  icon,
  onOpen,
  title,
}: {
  auras: Record<string, number>;
  communities: CommunityData[];
  icon: "flame" | "users" | "zap";
  onOpen: (community: CommunityData) => void;
  title: string;
}) {
  const { width } = useWindowDimensions();
  const { theme } = useAppTheme();
  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <RailIcon kind={icon} />
        <Text style={[styles.title, { color: theme.inputText }]}>{title}</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.track}
        horizontal
        decelerationRate="fast"
        snapToInterval={Math.max(1, width - COMMUNITY_PAGE_GUTTER * 2) + 16}
        snapToAlignment="start"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
      >
        {communities.map((community) => (
          <CommunityCard
            aura={auras[community.id] ?? 0}
            community={community}
            key={community.id}
            onPress={() => onOpen(community)}
            width={Math.max(1, width - COMMUNITY_PAGE_GUTTER * 2)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function RailIcon({ kind }: { kind: "flame" | "users" | "zap" }) {
  if (kind === "flame") {
    return <Flame color="#f97316" fill="#f97316" size={20} />;
  }
  if (kind === "users") {
    return <Users color="#f97316" fill="#f97316" size={20} />;
  }
  return <Zap color="#f97316" fill="#f97316" size={20} />;
}

const styles = StyleSheet.create({
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: COMMUNITY_PAGE_GUTTER,
  },
  root: { gap: 12 },
  title: { fontFamily: "SofiaProBold", fontSize: 18, lineHeight: 28 },
  track: {
    gap: 16,
    paddingBottom: 4,
    paddingHorizontal: COMMUNITY_PAGE_GUTTER,
  },
});
