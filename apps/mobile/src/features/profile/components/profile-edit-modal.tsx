import { updateUserProfileSchema } from "@asm/auth/validation";
import type { UpdateUserProfileValues } from "@asm/auth/validation";
import { Image } from "expo-image";
import { X } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { toast } from "@/components/feedback/toast";
import { IconButton3D } from "@/components/surface/icon-button-3d";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import {
  SettingsAvatarInput,
  SettingsBannerInput,
} from "@/features/settings/components/settings-media";
import {
  SettingsButton,
  SettingsCard,
  SettingsInput,
  SettingsSubcard,
} from "@/features/settings/components/settings-ui";
import { getApiBaseUrl } from "@/lib/api-env";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import type { ProfileHeaderProfile } from "../lib/profile-view-model";
import { ProfileBioEditor } from "./profile-bio-editor";

type ProfileDraft = UpdateUserProfileValues;

type SocialFieldName =
  | "customDomain"
  | "githubUsername"
  | "linkedinUsername"
  | "redditUsername"
  | "twitterUsername";

interface SocialFieldConfig {
  key: SocialFieldName;
  label: string;
  placeholder: string;
}

const SOCIAL_FIELDS: SocialFieldConfig[] = [
  {
    key: "customDomain",
    label: "Custom domain",
    placeholder: "yourdomain.com",
  },
  { key: "githubUsername", label: "GitHub", placeholder: "octocat" },
  { key: "linkedinUsername", label: "LinkedIn", placeholder: "john-doe" },
  { key: "redditUsername", label: "Reddit", placeholder: "yourusername" },
  { key: "twitterUsername", label: "Twitter / X", placeholder: "yourhandle" },
];

function draftFromProfile(profile: ProfileHeaderProfile): ProfileDraft {
  return {
    bio: profile.bio ?? "",
    customDomain: profile.customDomain ?? "",
    displayName: profile.displayName ?? "",
    githubUsername: profile.githubUsername ?? "",
    linkedinUsername: profile.linkedinUsername ?? "",
    redditUsername: profile.redditUsername ?? "",
    twitterUsername: profile.twitterUsername ?? "",
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
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

function responseErrorMessage(body: unknown, fallback: string): string {
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

export function ProfileEditModal({
  onClose,
  onSaved,
  profile,
}: {
  onClose: () => void;
  onSaved: () => void;
  profile: ProfileHeaderProfile;
}) {
  const { theme } = useAppTheme();
  const { runWithInstallToken } = useInstall();
  const [draft, setDraft] = useState<ProfileDraft>(() =>
    draftFromProfile(profile)
  );
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const bioOffset = useRef(0);
  const focusBio = useCallback(() => {
    scrollRef.current?.scrollTo({
      animated: true,
      y: Math.max(0, bioOffset.current - 12),
    });
  }, []);
  // Mirrors the server response so a replaced avatar shows immediately, the
  // same way web writes the new URL into the query cache optimistically.
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? null);
  const [bannerUrl, setBannerUrl] = useState(profile.bannerUrl ?? null);
  const setField = <Key extends keyof ProfileDraft>(
    key: Key,
    value: ProfileDraft[Key]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (saving) {
      return;
    }
    const parsed = updateUserProfileSchema.safeParse(draft);
    if (!parsed.success) {
      toast({
        description:
          parsed.error.issues[0]?.message ??
          "Check the highlighted profile details.",
        title: "Check your profile",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
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
          const body = await readResponseBody(response);
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
            message: responseErrorMessage(
              body,
              "Couldn't save your profile. Try again."
            ),
          } as const;
        },
        (value) => value.kind === "install-token-required"
      );

      if (!result) {
        setSaving(false);
        return;
      }
      if (result.kind !== "success") {
        toast({
          description:
            result.kind === "error"
              ? result.message
              : "Couldn't verify this install. Try again.",
          title: "Update failed",
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
      toast({
        description: "Your profile has been updated.",
        title: "Profile saved",
      });
      onSaved();
      onClose();
      setSaving(false);
    } catch {
      toast({
        description: "Couldn't save your profile. Try again.",
        title: "Update failed",
        variant: "destructive",
      });
      setSaving(false);
    }
  };

  const close = () => {
    if (!saving) {
      onClose();
    }
  };
  return (
    <Modal animationType="fade" onRequestClose={close} transparent visible>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{
          backgroundColor: "rgba(0,0,0,0.6)",
          flex: 1,
          justifyContent: "center",
          padding: 16,
        }}
      >
        <SettingsCard
          padded={false}
          style={{
            alignSelf: "center",
            flexShrink: 1,
            maxHeight: "85%",
            maxWidth: 480,
            overflow: "hidden",
            width: "100%",
          }}
        >
          <View
            style={{
              alignItems: "center",
              borderBottomWidth: 1,
              borderColor: theme.cardBorder,
              flexDirection: "row",
              gap: 12,
              padding: 16,
            }}
          >
            <Image
              source={avatarPlaceholder}
              style={{ height: 40, width: 40 }}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: theme.inputText,
                  fontFamily: "SofiaProBold",
                  fontSize: 17,
                }}
              >
                Edit Profile
              </Text>
              <Text
                style={{
                  color: theme.dividerText,
                  fontFamily: "SofiaProReg",
                  fontSize: 12,
                }}
              >
                Update your profile details
              </Text>
            </View>
            {saving ? null : (
              <IconButton3D
                accessibilityLabel="Close profile editor"
                icon={X}
                onPress={close}
              />
            )}
          </View>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
            contentContainerStyle={{ gap: 16, padding: 16 }}
          >
            <View style={{ gap: 6 }}>
              <Text
                style={{
                  color: theme.dividerText,
                  fontFamily: "SofiaProMed",
                  fontSize: 13,
                }}
              >
                Header image
              </Text>
              <View style={{ borderRadius: 12, overflow: "hidden" }}>
                <SettingsBannerInput
                  height={104}
                  canRemove={Boolean(bannerUrl)}
                  src={bannerUrl}
                  onChanged={(url) => {
                    setBannerUrl(url);
                    onSaved();
                  }}
                />
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <Text
                style={{
                  color: theme.dividerText,
                  fontFamily: "SofiaProMed",
                  fontSize: 13,
                }}
              >
                Avatar
              </Text>
              <SettingsSubcard
                style={{ alignItems: "center", flexDirection: "row", gap: 12 }}
              >
                <SettingsAvatarInput
                  size={84}
                  canDelete={Boolean(avatarUrl)}
                  src={avatarUrl}
                  onChanged={(url) => {
                    setAvatarUrl(url);
                    onSaved();
                  }}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text
                    style={{
                      color: theme.inputText,
                      fontFamily: "SofiaProMed",
                      fontSize: 13,
                    }}
                  >
                    Change profile photo
                  </Text>
                  <Text
                    style={{
                      color: theme.dividerText,
                      fontFamily: "SofiaProReg",
                      fontSize: 12,
                    }}
                  >
                    Supports JPG, PNG, and GIF under 10MB
                  </Text>
                </View>
              </SettingsSubcard>
            </View>
            <SettingsInput
              label="Display name"
              autoCapitalize="words"
              maxLength={50}
              placeholder="Your display name"
              value={draft.displayName}
              onChangeText={(value) => setField("displayName", value)}
            />
            <View
              onLayout={(event) => {
                bioOffset.current = event.nativeEvent.layout.y;
              }}
            >
              <ProfileBioEditor
                onFocus={focusBio}
                value={draft.bio}
                onChangeText={(value) => setField("bio", value)}
              />
            </View>
            <Text
              style={{
                color: theme.inputText,
                fontFamily: "SofiaProMed",
                fontSize: 14,
              }}
            >
              Social links
            </Text>
            {SOCIAL_FIELDS.map((field) => (
              <SettingsInput
                key={field.key}
                label={field.label}
                maxLength={field.key === "customDomain" ? 100 : 50}
                placeholder={field.placeholder}
                value={draft[field.key] ?? ""}
                onChangeText={(value) => setField(field.key, value)}
              />
            ))}
          </ScrollView>
          <View
            style={{
              borderColor: theme.cardBorder,
              borderTopWidth: 1,
              flexDirection: "row",
              gap: 10,
              justifyContent: "flex-end",
              padding: 16,
            }}
          >
            <SettingsButton
              label="Cancel"
              tone="gray"
              disabled={saving}
              onPress={close}
            />
            <SettingsButton
              label="Save Changes"
              loading={saving}
              onPress={() => {
                void save();
              }}
            />
          </View>
        </SettingsCard>
      </KeyboardAvoidingView>
    </Modal>
  );
}
