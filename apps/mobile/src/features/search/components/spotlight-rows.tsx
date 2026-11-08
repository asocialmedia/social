// Native ports of web Spotlight's SearchRow, ResultAvatar, EmptySearch, the
// section header and the loading skeleton (components/search/spotlight.tsx).
import { Clock3, FileText, Search, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { CommunityAvatar } from "@/features/communities/components/community-avatar";
import { BlueskyIcon } from "@/features/feed/components/bluesky-icon";

import { formatSearchTime } from "../lib/search-history";
import { sourceLabel } from "../lib/spotlight-items";
import type { SpotlightResultItem } from "../lib/spotlight-items";
import { chipFlat } from "./spotlight-recipes";
import type { SpotlightPalette } from "./spotlight-recipes";

// Web's BlueskyIcon ink (`text-sky-500`), white on the Bluesky surface.
export const BLUESKY_MARK = "#0ea5e9";

export function GroupHeader({
  aside,
  palette,
  title,
  trailing,
}: {
  aside?: string;
  palette: SpotlightPalette;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.groupHeader}>
      <Text style={[styles.groupTitle, { color: palette.muted }]}>{title}</Text>
      {aside || trailing ? (
        <View style={styles.groupAside}>
          {aside ? (
            <Text
              style={[
                styles.groupAsideText,
                {
                  color: palette.blue
                    ? "rgba(255, 255, 255, 0.75)"
                    : palette.muted,
                },
              ]}
            >
              {aside}
            </Text>
          ) : null}
          {trailing}
        </View>
      ) : null}
    </View>
  );
}

function ResultAvatar({
  isDark,
  item,
  palette,
}: {
  isDark: boolean;
  item: SpotlightResultItem;
  palette: SpotlightPalette;
}) {
  if (item.type === "history") {
    const chip = chipFlat(isDark, false);
    return (
      <View
        style={[
          styles.historyTile,
          palette.blue
            ? styles.historyTileBlue
            : {
                backgroundColor: chip.background,
                borderColor: chip.border,
                boxShadow: chip.shadows,
              },
        ]}
      >
        <Clock3 color={palette.muted} size={16} />
      </View>
    );
  }
  if (item.rawCommunity) {
    return <CommunityAvatar community={item.rawCommunity} size={40} />;
  }
  return (
    <View style={palette.blue ? styles.avatarRingBlue : null}>
      <UserAvatar seed={item.id} size={40} url={item.avatarUrl} />
    </View>
  );
}

export function SearchRow({
  isDark,
  item,
  onRemove,
  onSelect,
  palette,
}: {
  isDark: boolean;
  item: SpotlightResultItem;
  onRemove?: () => void;
  onSelect: () => void;
  palette: SpotlightPalette;
}) {
  let timeLabel = "";
  if (item.searchedAt) {
    timeLabel = ` · ${formatSearchTime(item.searchedAt)}`;
  } else if (item.source === "asm") {
    timeLabel = " · ASM";
  }
  const isPost = item.type === "post";
  const subtitle =
    item.subtitle ||
    (item.searchSource ? sourceLabel(item.searchSource) : "asocialmedia");
  return (
    <View style={styles.rowShell}>
      <Pressable
        accessibilityRole="button"
        onPress={onSelect}
        style={({ pressed }) => [
          styles.row,
          onRemove ? styles.rowWithRemove : null,
          pressed ? { backgroundColor: palette.rowPressed } : null,
        ]}
      >
        <View style={styles.avatarWrap}>
          <ResultAvatar isDark={isDark} item={item} palette={palette} />
          {isPost ? (
            <View
              style={[
                styles.postBadge,
                palette.blue
                  ? styles.postBadgeBlue
                  : {
                      backgroundColor: isDark ? "#1f1f1f" : "#f9f9f9",
                      borderColor: isDark ? "#3d3d3d" : "#d8d8d8",
                    },
              ]}
            >
              <FileText color={palette.muted} size={10} />
            </View>
          ) : null}
        </View>
        <View style={styles.rowCopy}>
          <View style={styles.titleLine}>
            <Text
              numberOfLines={isPost ? 2 : 1}
              style={[styles.rowTitle, { color: palette.foreground }]}
            >
              {item.displayName}
            </Text>
            {item.source === "bluesky" ? (
              <BlueskyIcon
                color={palette.blue ? "#ffffff" : BLUESKY_MARK}
                size={12}
              />
            ) : null}
          </View>
          <Text
            numberOfLines={1}
            style={[styles.rowSubtitle, { color: palette.muted }]}
          >
            {subtitle}
            {timeLabel}
          </Text>
          {item.reason ? (
            <Text
              numberOfLines={1}
              style={[styles.rowReason, { color: palette.muted }]}
            >
              {item.reason}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityLabel={`Remove ${item.displayName} from history`}
          accessibilityRole="button"
          hitSlop={4}
          onPress={onRemove}
          style={styles.removeButton}
        >
          <X color={palette.muted} size={14} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptySearch({
  description,
  palette,
  title,
}: {
  description: string;
  palette: SpotlightPalette;
  title: string;
}) {
  return (
    <View style={styles.empty}>
      <Search color={palette.muted} size={28} strokeWidth={1.5} />
      <Text style={[styles.emptyTitle, { color: palette.foreground }]}>
        {title}
      </Text>
      <Text style={[styles.emptyDescription, { color: palette.muted }]}>
        {description}
      </Text>
    </View>
  );
}

export function SearchSkeleton({ palette }: { palette: SpotlightPalette }) {
  return (
    <View accessibilityLabel="Loading search results" style={styles.skeleton}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.skeletonRow}>
          <View
            style={[
              styles.skeletonAvatar,
              { backgroundColor: palette.skeleton },
            ]}
          />
          <View style={styles.skeletonLines}>
            <View
              style={[
                styles.skeletonLine,
                styles.skeletonLineLong,
                { backgroundColor: palette.skeleton },
              ]}
            />
            <View
              style={[
                styles.skeletonLine,
                styles.skeletonLineShort,
                { backgroundColor: palette.skeleton },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  avatarRingBlue: {
    borderRadius: 12,
    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.5)",
  },
  avatarWrap: {
    flexShrink: 0,
    position: "relative",
  },
  empty: {
    alignItems: "center",
    alignSelf: "center",
    justifyContent: "center",
    maxWidth: 384,
    minHeight: 224,
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  emptyDescription: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    textAlign: "center",
  },
  emptyTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 16,
    textAlign: "center",
  },
  groupAside: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  groupAsideText: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
  },
  groupHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 6,
    minHeight: 24,
    paddingHorizontal: 8,
  },
  groupTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  historyTile: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  historyTileBlue: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderColor: "rgba(255, 255, 255, 0.4)",
  },
  postBadge: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    bottom: -4,
    height: 16,
    justifyContent: "center",
    position: "absolute",
    right: -4,
    width: 16,
  },
  postBadgeBlue: {
    backgroundColor: "#0866df",
    borderColor: "rgba(255, 255, 255, 0.5)",
  },
  removeButton: {
    alignItems: "center",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    marginRight: 4,
    opacity: 0.7,
    width: 32,
  },
  row: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    flexDirection: "row",
    gap: 12,
    minWidth: 0,
    padding: 10,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowReason: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
    marginTop: 2,
  },
  rowShell: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    minWidth: 0,
  },
  rowSubtitle: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  rowTitle: {
    flexShrink: 1,
    fontFamily: "SofiaProMed",
    fontSize: 14,
    lineHeight: 20,
  },
  rowWithRemove: {
    paddingRight: 0,
  },
  skeleton: {
    gap: 12,
    padding: 8,
  },
  skeletonAvatar: {
    borderRadius: 12,
    height: 40,
    width: 40,
  },
  skeletonLine: {
    borderRadius: 4,
    height: 12,
  },
  skeletonLineLong: {
    width: 160,
  },
  skeletonLineShort: {
    width: 96,
  },
  skeletonLines: {
    gap: 8,
  },
  skeletonRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  titleLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minWidth: 0,
  },
});
