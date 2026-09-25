import { updateUserProfileSchema } from "@asm/auth/validation";
import type { UpdateUserProfileValues } from "@asm/auth/validation";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import type { ProfileHeaderProfile } from "../lib/profile-view-model";

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

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
          ]}
        >
          <View style={styles.handle} />
          <Text style={[styles.title, { color: theme.inputText }]}>
            Edit profile
          </Text>
          <Text style={[styles.subtitle, { color: theme.dividerText }]}>
            Update your profile details. Avatar and banner editing are not
            available in this mobile form.
          </Text>
          <ScrollView
            contentContainerStyle={styles.fields}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
          >
            <Text style={[styles.label, { color: theme.dividerText }]}>
              Display name
            </Text>
            <TextInput
              accessibilityLabel="Display name"
              autoCapitalize="words"
              maxLength={50}
              onChangeText={(value) => setField("displayName", value)}
              placeholder="Your display name"
              placeholderTextColor={theme.dividerText}
              style={[
                styles.input,
                { borderColor: theme.cardBorder, color: theme.inputText },
              ]}
              value={draft.displayName}
            />
            <Text style={[styles.label, { color: theme.dividerText }]}>
              Bio
            </Text>
            <TextInput
              accessibilityLabel="Bio"
              maxLength={2000}
              multiline
              onChangeText={(value) => setField("bio", value)}
              placeholder="Tell us a little bit about yourself"
              placeholderTextColor={theme.dividerText}
              style={[
                styles.input,
                styles.bio,
                { borderColor: theme.cardBorder, color: theme.inputText },
              ]}
              value={draft.bio}
            />
            {SOCIAL_FIELDS.map((field) => (
              <View key={field.key}>
                <Text style={[styles.label, { color: theme.dividerText }]}>
                  {field.label}
                </Text>
                <TextInput
                  accessibilityLabel={field.label}
                  autoCapitalize="none"
                  maxLength={field.key === "customDomain" ? 100 : 50}
                  onChangeText={(value) => setField(field.key, value)}
                  placeholder={field.placeholder}
                  placeholderTextColor={theme.dividerText}
                  style={[
                    styles.input,
                    { borderColor: theme.cardBorder, color: theme.inputText },
                  ]}
                  value={draft[field.key] ?? ""}
                />
              </View>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="Cancel profile edit"
              accessibilityRole="button"
              onPress={onClose}
              style={styles.cancel}
            >
              <Text style={[styles.cancelText, { color: theme.inputText }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Save profile"
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
              disabled={saving}
              onPress={() => {
                void save();
              }}
              style={[styles.save, saving && styles.disabled]}
            >
              <Text style={styles.saveText}>{saving ? "Saving…" : "Save"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 10,
  },
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.55)",
    flex: 1,
    justifyContent: "flex-end",
  },
  bio: { minHeight: 88, textAlignVertical: "top" },
  cancel: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11 },
  cancelText: { fontFamily: "SofiaProMed", fontSize: 14 },
  disabled: { opacity: 0.5 },
  fields: { gap: 8, paddingBottom: 8 },
  handle: {
    alignSelf: "center",
    backgroundColor: "rgba(128,128,128,0.5)",
    borderRadius: 99,
    height: 4,
    marginBottom: 6,
    width: 40,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontFamily: "SofiaProReg",
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: { fontFamily: "SofiaProMed", fontSize: 13, marginTop: 6 },
  save: {
    backgroundColor: "#f97316",
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  saveText: { color: "#fff", fontFamily: "SofiaProBold", fontSize: 14 },
  scroll: { flexShrink: 1 },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    flexShrink: 1,
    gap: 8,
    maxHeight: "90%",
    padding: 20,
    paddingBottom: 32,
  },
  subtitle: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  title: { fontFamily: "SofiaProBold", fontSize: 20, marginBottom: 8 },
});
