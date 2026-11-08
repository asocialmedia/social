// Two pieces of web's explore-client that only appear around a search:
// the in-place "Search explore" field (search icon, or the search loader
// while results load, plus a clear button) and the Communities strip shown
// above the search masonry.
import { useRouter } from "expo-router";
import { Search, X } from "lucide-react-native";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ZephLoader } from "@/components/feedback/zeph-loader";
import { premiumInput } from "@/components/surface/recipes";
import { CommunityAvatar } from "@/features/communities/components/community-avatar";
import { useAppTheme } from "@/theme";

import type { ExploreCommunityResult } from "../lib/explore-api";

export function ExploreSearchField({
  fetching,
  onChange,
  onSubmit,
  value,
}: {
  fetching: boolean;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  value: string;
}) {
  const { isDark } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const field = premiumInput(isDark, focused);
  return (
    <View style={styles.field}>
      <View pointerEvents="none" style={styles.leading}>
        {fetching ? (
          <ZephLoader color="#f97316" style={styles.loader} variant="search" />
        ) : (
          <Search color={field.placeholder} size={16} />
        )}
      </View>
      <TextInput
        accessibilityLabel="Search explore"
        autoComplete="off"
        onBlur={() => setFocused(false)}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onSubmitEditing={onSubmit}
        placeholder="Search explore"
        placeholderTextColor={field.placeholder}
        returnKeyType="search"
        style={[
          styles.input,
          {
            backgroundColor: field.background,
            boxShadow: field.shadows,
            color: field.text,
          },
        ]}
        value={value}
      />
      {value ? (
        <Pressable
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onChange("")}
          style={styles.clear}
        >
          <X color={field.placeholder} size={14} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function ExploreCommunities({
  communities,
}: {
  communities: readonly ExploreCommunityResult[];
}) {
  const router = useRouter();
  const { theme } = useAppTheme();
  return (
    <View accessibilityLabel="Communities" style={styles.section}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: theme.dividerText }]}
      >
        COMMUNITIES
      </Text>
      <ScrollView
        contentContainerStyle={styles.row}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {communities.map((community) => (
          <Pressable
            accessibilityLabel={`Open a/${community.slug}`}
            accessibilityRole="button"
            key={community.id}
            onPress={() =>
              router.push({
                params: { slug: community.slug },
                pathname: "/a/[slug]",
              })
            }
            style={({ pressed }) => [
              styles.community,
              {
                backgroundColor: pressed ? theme.dividerLine : "transparent",
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <CommunityAvatar community={community} size={36} />
            <View style={styles.communityCopy}>
              <Text
                numberOfLines={1}
                style={[styles.communityName, { color: theme.inputText }]}
              >
                {community.name}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.communitySlug, { color: theme.dividerText }]}
              >
                a/{community.slug}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  clear: {
    alignItems: "center",
    borderRadius: 9999,
    height: 24,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    top: 8,
    width: 24,
  },
  community: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: 224,
  },
  communityCopy: { flex: 1, minWidth: 0 },
  communityName: { fontFamily: "SofiaProMed", fontSize: 14 },
  communitySlug: { fontFamily: "SofiaProReg", fontSize: 12 },
  field: { margin: 8 },
  heading: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  input: {
    borderCurve: "continuous",
    borderRadius: 12,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    height: 40,
    paddingLeft: 36,
    paddingRight: 36,
  },
  leading: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    left: 12,
    position: "absolute",
    top: 0,
    width: 16,
    zIndex: 1,
  },
  loader: { height: 16, width: 16 },
  row: { gap: 8, paddingBottom: 4 },
  section: { marginBottom: 20, paddingHorizontal: 8 },
});
