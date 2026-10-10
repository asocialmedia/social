// Native port of web's `settings/tabs/profile-settings.tsx`.
//
// The hero (banner spanning the top, avatar overlapping its lower-left by half,
// display-name field beside it), the bio editor with its word counter, and the
// two-column social links grid all match web. Media picks upload immediately
// through the same pipeline the profile edit modal uses, so the hero reflects a
// saved image without a second round-trip; Save submits the text fields through
// PATCH /api/users/[userId]/profile, exactly like web.
import { updateUserProfileSchema } from "@asm/auth/validation";
import type { UpdateUserProfileValues } from "@asm/auth/validation";
import { useRouter } from "expo-router";
import { Link2, UserRound } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AnimatedWordCounter } from "@/components/feedback/animated-word-counter";
import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import type { SessionUser } from "@/features/auth/state/session";
import { fetchProfileByUsername } from "@/features/profile/lib/profile-api";
import type { ProfileHeaderProfile } from "@/features/profile/lib/profile-view-model";
import { getApiBaseUrl } from "@/lib/api-env";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import { SectionAnchor } from "../lib/settings-scroll";
import { SettingsBannerInput, SettingsAvatarInput } from "./settings-media";
import { SettingsCardSkeleton } from "./settings-skeleton";
import { SocialBrandIcon } from "./settings-social-icons";
import {
  SettingsButton,
  SettingsCard,
  SettingsInput,
  SettingsSectionHeader,
} from "./settings-ui";

const whitespaceRegex = /\s+/;

type SocialFieldName =
  | "githubUsername"
  | "linkedinUsername"
  | "redditUsername"
  | "twitterUsername";

interface SocialFieldConfig {
  brand: "github" | "linkedin" | "reddit" | "x-twitter";
  label: string;
  name: SocialFieldName;
  placeholder: string;
}

// Web's SOCIAL_FIELDS, in the same order and with the same placeholders.
const SOCIAL_FIELDS: SocialFieldConfig[] = [
  {
    brand: "github",
    label: "GitHub",
    name: "githubUsername",
    placeholder: "octocat",
  },
  {
    brand: "linkedin",
    label: "LinkedIn",
    name: "linkedinUsername",
    placeholder: "john-doe",
  },
  {
    brand: "x-twitter",
    label: "Twitter / X",
    name: "twitterUsername",
    placeholder: "yourhandle",
  },
  {
    brand: "reddit",
    label: "Reddit",
    name: "redditUsername",
    placeholder: "yourusername",
  },
];

interface ProfileDraft {
  bio: string;
  displayName: string;
  githubUsername: string;
  linkedinUsername: string;
  redditUsername: string;
  twitterUsername: string;
}

function draftFromProfile(profile: ProfileHeaderProfile): ProfileDraft {
  return {
    bio: profile.bio ?? "",
    displayName: profile.displayName ?? "",
    githubUsername: profile.githubUsername ?? "",
    linkedinUsername: profile.linkedinUsername ?? "",
    redditUsername: profile.redditUsername ?? "",
    twitterUsername: profile.twitterUsername ?? "",
  };
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessageOf(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body as { error?: unknown };
    if (typeof error === "string" && error) {
      return error;
    }
  }
  if (typeof body === "string" && body) {
    return body;
  }
  return fallback;
}

function LegalSettingsLinks() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const openDocument = (document: "privacy" | "terms") => {
    router.push({ params: { document }, pathname: "/legal/[document]" });
  };

  return (
    <SettingsCard>
      <Text style={[styles.legalTitle, { color: theme.inputText }]}>Legal</Text>
      <Text style={[styles.note, { color: theme.dividerText }]}>
        The Terms and Privacy Policy you accepted when you signed up.
      </Text>
      <Pressable
        accessibilityRole="link"
        onPress={() => openDocument("terms")}
        style={styles.legalLink}
      >
        <Text style={styles.heroLink}>Terms &amp; Conditions</Text>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        onPress={() => openDocument("privacy")}
        style={styles.legalLink}
      >
        <Text style={styles.heroLink}>Privacy Policy</Text>
      </Pressable>
    </SettingsCard>
  );
}

export function ProfileTab({
  onChanged,
  onNavigateToAccount,
  scrollRef,
  user,
}: {
  onChanged: () => void;
  onNavigateToAccount: () => void;
  scrollRef: RefObject<ScrollView | null>;
  user: SessionUser | null;
}) {
  const { theme } = useAppTheme();
  const { runWithInstallToken } = useInstall();
  const [profile, setProfile] = useState<ProfileHeaderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<ProfileDraft>({
    bio: "",
    displayName: "",
    githubUsername: "",
    linkedinUsername: "",
    redditUsername: "",
    twitterUsername: "",
  });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const cookie = await authClient.getCookie();
      const next = await fetchProfileByUsername(user.username ?? user.id, {
        apiBase: getApiBaseUrl(),
        cookie,
      });
      setProfile(next);
      setDraft(draftFromProfile(next));
      setAvatarUrl(next.avatarUrl);
      setBannerUrl(next.bannerUrl);
    } catch {
      toast({
        description: "Couldn't load your profile, pull to retry.",
        title: "Load failed",
        variant: "destructive",
      });
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- load() awaits the fetch before touching state
    void load();
  }, [load]);

  const setField = <Key extends keyof ProfileDraft>(
    key: Key,
    value: ProfileDraft[Key]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!profile || saving) {
      return;
    }
    const values: UpdateUserProfileValues = {
      bio: draft.bio,
      customDomain: profile.customDomain ?? "",
      displayName: draft.displayName,
      githubUsername: draft.githubUsername,
      linkedinUsername: draft.linkedinUsername,
      redditUsername: draft.redditUsername,
      twitterUsername: draft.twitterUsername,
    };
    const parsed = updateUserProfileSchema.safeParse(values);
    if (!parsed.success) {
      toast({
        description:
          parsed.error.issues[0]?.message ?? "Check the highlighted fields.",
        title: "Couldn't Save",
        variant: "destructive",
      });
      return;
    }
    const hasChanges =
      parsed.data.displayName !== (profile.displayName ?? "") ||
      parsed.data.bio !== (profile.bio ?? "") ||
      parsed.data.githubUsername !== (profile.githubUsername ?? "") ||
      parsed.data.linkedinUsername !== (profile.linkedinUsername ?? "") ||
      parsed.data.twitterUsername !== (profile.twitterUsername ?? "") ||
      parsed.data.redditUsername !== (profile.redditUsername ?? "");
    if (!hasChanges) {
      toast({
        description: "Looks like nothing changed, make a tweak and save!",
        title: "No Changes",
      });
      return;
    }

    setSaving(true);
    const result = await runWithInstallToken(
      async () => {
        const response = await fetch(
          `${getApiBaseUrl()}/api/users/${encodeURIComponent(profile.id)}/profile`,
          {
            body: JSON.stringify(parsed.data),
            headers: {
              "Content-Type": "application/json",
              cookie: await authClient.getCookie(),
            },
            method: "PATCH",
          }
        );
        const body = await readBody(response);
        if (response.ok) {
          return { kind: "success" } as const;
        }
        if (
          response.status === 403 &&
          typeof body === "object" &&
          body !== null &&
          (body as { error?: unknown }).error === "install-token-required"
        ) {
          return { kind: "install-token-required" } as const;
        }
        return {
          kind: "error",
          message: errorMessageOf(body, "Couldn't save your profile."),
        } as const;
      },
      (value) => value.kind === "install-token-required"
    );
    setSaving(false);
    if (result === null) {
      return;
    }
    if (result.kind !== "success") {
      toast({
        description:
          result.kind === "error"
            ? result.message
            : "Couldn't verify this install.",
        title: "Couldn't Save",
        variant: "destructive",
      });
      return;
    }
    setProfile((current) =>
      current ? { ...current, ...parsed.data } : current
    );
    toast({
      description: "Your profile is looking fresh!",
      title: "Profile Updated",
    });
    onChanged();
  };

  if (!user) {
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        ref={scrollRef}
        showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
      >
        <SettingsSectionHeader
          description="How you appear across asocialmedia"
          icon={UserRound}
          title="Profile"
        />
        <SettingsCard>
          <Text style={[styles.note, { color: theme.dividerText }]}>
            Sign in to edit your profile.
          </Text>
        </SettingsCard>
        <LegalSettingsLinks />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      ref={scrollRef}
      showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
    >
      <SettingsSectionHeader
        description="How you appear across asocialmedia"
        icon={UserRound}
        title="Profile"
      />

      {loading && !profile ? (
        <>
          <SettingsCardSkeleton fields={1} />
          <SettingsCardSkeleton fields={2} />
        </>
      ) : (
        <>
          <SectionAnchor id="settings-profile" tab="profile">
            <SettingsCard padded={false} style={styles.heroCard}>
              <SettingsBannerInput
                canRemove={Boolean(bannerUrl)}
                onChanged={setBannerUrl}
                src={bannerUrl}
              />
              <View style={styles.heroRow}>
                <View style={styles.avatarSlot}>
                  <SettingsAvatarInput
                    canDelete={Boolean(avatarUrl)}
                    onChanged={setAvatarUrl}
                    src={avatarUrl}
                  />
                </View>
                <View style={styles.heroName}>
                  <SettingsInput
                    label="Display name"
                    onChangeText={(value) => setField("displayName", value)}
                    placeholder="Your display name"
                    value={draft.displayName}
                  />
                  <Text style={[styles.heroHint, { color: theme.dividerText }]}>
                    Want to edit your username?{" "}
                    <Text onPress={onNavigateToAccount} style={styles.heroLink}>
                      Visit here
                    </Text>
                  </Text>
                </View>
              </View>
            </SettingsCard>
          </SectionAnchor>

          <SettingsCard>
            <View style={styles.bioBlock}>
              <SettingsInput
                label="Bio"
                maxLength={2000}
                multiline
                onChangeText={(value) => setField("bio", value)}
                placeholder="Tell us a little bit about yourself - @mention, #tag or drop a link"
                value={draft.bio}
              />
              <View style={styles.counterRow}>
                <AnimatedWordCounter
                  current={
                    draft.bio.trim().split(whitespaceRegex).filter(Boolean)
                      .length
                  }
                  max={400}
                />
              </View>
            </View>

            <View style={styles.socialBlock}>
              <View style={styles.socialTitleRow}>
                <Link2 color={theme.dividerText} size={16} />
                <Text style={[styles.socialTitle, { color: theme.inputText }]}>
                  Social links
                </Text>
              </View>
              <View style={styles.socialGrid}>
                {SOCIAL_FIELDS.map((item) => (
                  <SettingsInput
                    key={item.name}
                    label={item.label}
                    leading={
                      <SocialBrandIcon
                        color={theme.dividerText}
                        name={item.brand}
                        size={16}
                      />
                    }
                    onChangeText={(value) => setField(item.name, value)}
                    placeholder={item.placeholder}
                    value={draft[item.name]}
                  />
                ))}
              </View>
            </View>
          </SettingsCard>

          <View style={styles.saveRow}>
            <SettingsButton
              disabled={saving}
              label={saving ? "Saving…" : "Save Changes"}
              onPress={() => {
                void save();
              }}
            />
          </View>
        </>
      )}
      <LegalSettingsLinks />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  avatarSlot: { marginTop: -56 },
  bioBlock: { gap: 6 },
  content: { gap: 18, padding: 16, paddingBottom: 96 },
  counterRow: { alignItems: "flex-end" },
  heroCard: { overflow: "hidden" },
  heroHint: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
  },
  heroLink: { color: "#ff9500", fontFamily: "SofiaProMed" },
  heroName: { flex: 1, minWidth: 0, paddingTop: 8 },
  heroRow: {
    flexDirection: "row",
    gap: 16,
    paddingBottom: 20,
    paddingHorizontal: 16,
  },
  legalLink: { paddingVertical: 6 },
  legalTitle: { fontFamily: "SofiaProBold", fontSize: 16 },
  note: { fontFamily: "SofiaProReg", fontSize: 14 },
  saveRow: { alignItems: "flex-end" },
  socialBlock: { gap: 14, paddingTop: 4 },
  socialGrid: { gap: 14 },
  socialTitle: { fontFamily: "SofiaProBold", fontSize: 14 },
  socialTitleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
});
