// The settings screen: web's three tabs over one route.
//
// Web renders a sidebar on desktop and keeps the active tab in `?tab=`; native
// uses the same query param behind a tab strip, so a settings deep link lands on
// the same section it would on the web.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { FossBanner } from "@/components/misc/foss-banner";
import { useSessionContext } from "@/features/auth/state/session";
import { useAppTheme } from "@/theme";

import { MobileHeader } from "../../home/components/mobile-header";
import { resolveSettingsTab } from "../lib/settings-tabs";
import { accountFactsFrom } from "../lib/settings-view-model";
import { AccountTab } from "./account-tab";
import { SecurityTab } from "./security-tab";
import { SettingsTabBar } from "./settings-ui";

export function SettingsScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const { refresh, user } = useSessionContext();
  const tab = resolveSettingsTab(params.tab);

  // The session user is the source of truth for these facts, so a username
  // change, a new password or an unlinked provider all land here by
  // revalidating the session rather than by fetching the user a second time.
  const facts = useMemo(() => accountFactsFrom(user), [user]);

  const onChanged = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
        user={
          user
            ? {
                id: user.id,
                image: user.image,
                username: user.username ?? user.name,
              }
            : null
        }
      />
      <SettingsTabBar
        active={tab}
        onChange={(next) => {
          router.replace({ params: { tab: next }, pathname: "/settings" });
        }}
      />
      {tab === "profile" ? (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.profileLead}>
            <Text style={[styles.leadTitle, { color: theme.inputText }]}>
              Profile
            </Text>
            <Text style={[styles.leadBody, { color: theme.dividerText }]}>
              Your display name, bio, links, avatar and banner.
            </Text>
            <Pressable
              accessibilityLabel="Edit profile"
              accessibilityRole="button"
              disabled={!user}
              onPress={() => {
                if (!user) {
                  return;
                }
                router.push({
                  params: { username: user.username ?? user.name ?? user.id },
                  pathname: "/users/[username]",
                });
              }}
              style={styles.leadAction}
            >
              <Text style={styles.leadActionText}>
                {user ? "Edit profile" : "Sign in to edit your profile"}
              </Text>
            </Pressable>
          </View>
          <View
            style={[
              styles.legalCard,
              { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
            ]}
          >
            <Text style={[styles.leadTitle, { color: theme.inputText }]}>
              Legal
            </Text>
            <Text style={[styles.leadBody, { color: theme.dividerText }]}>
              The Terms and Privacy Policy you accepted when you signed up.
            </Text>
            <Pressable
              accessibilityLabel="Read the Terms and Conditions"
              accessibilityRole="button"
              onPress={() => {
                router.push({
                  params: { document: "terms" },
                  pathname: "/legal/[document]",
                });
              }}
              style={styles.legalLink}
            >
              <Text style={styles.leadActionText}>Terms &amp; Conditions</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Read the Privacy Policy"
              accessibilityRole="button"
              onPress={() => {
                router.push({
                  params: { document: "privacy" },
                  pathname: "/legal/[document]",
                });
              }}
              style={styles.legalLink}
            >
              <Text style={styles.leadActionText}>Privacy Policy</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}
      {tab === "account" ? (
        <AccountTab facts={facts} onChanged={onChanged} />
      ) : null}
      {tab === "security" ? <SecurityTab /> : null}
      <View style={styles.fossSlot}>
        <FossBanner />
      </View>
    </View>
  );
}

export default SettingsScreen;

const styles = StyleSheet.create({
  content: { gap: 14, padding: 16, paddingBottom: 40 },
  fossSlot: { paddingHorizontal: 16, paddingTop: 8 },
  leadAction: { paddingVertical: 6 },
  leadActionText: {
    color: "#ff9500",
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  leadBody: { fontFamily: "SofiaProReg", fontSize: 13, lineHeight: 18 },
  leadTitle: { fontFamily: "SofiaProBold", fontSize: 18 },
  legalCard: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  legalLink: { paddingVertical: 4 },
  profileLead: { gap: 6 },
  root: { flex: 1 },
});
