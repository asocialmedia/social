import { updateUserProfileSchema } from "@asm/auth/validation";
import type { UpdateUserProfileValues } from "@asm/auth/validation";
import { Image } from "expo-image";
import { Camera, Trash2 } from "lucide-react-native";
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

import type { ProfileImageKind } from "../lib/profile-media";
import {
  deleteProfileMedia,
  updateProfileMedia,
} from "../lib/profile-media-mutations";
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
  // Mirrors the server response so a replaced avatar shows immediately, the
  // same way web writes the new URL into the query cache optimistically.
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? null);
  const [bannerUrl, setBannerUrl] = useState(profile.bannerUrl ?? null);
  const [mediaBusy, setMediaBusy] = useState<ProfileImageKind | null>(null);
  const [mediaProgress, setMediaProgress] = useState(0);

  const setField = <Key extends keyof ProfileDraft>(
    key: Key,
    value: ProfileDraft[Key]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const changeMedia = async (kind: ProfileImageKind, remove: boolean) => {
    if (mediaBusy) {
      return;
    }
    setMediaBusy(kind);
    setMediaProgress(0);
    const result = remove
      ? await deleteProfileMedia(kind, runWithInstallToken)
      : await updateProfileMedia(
          kind,
          {
            onBytes: setMediaProgress,
            onStage: (stage) => {
              if (stage === "processing") {
                setMediaProgress(100);
              }
            },
          },
          runWithInstallToken
        );
    setMediaBusy(null);
    setMediaProgress(0);
    if (result.kind === "cancelled") {
      return;
    }
    if (result.kind === "error") {
      toast({
        description: result.message,
        title: "That didn't work",
        variant: "destructive",
      });
      return;
    }
    if (result.kind !== "success") {
      // The install gate was dismissed, so nothing was written.
      return;
    }
    if (kind === "avatar") {
      setAvatarUrl(result.url);
    } else {
      setBannerUrl(result.url);
    }
    toast({
      description: remove
        ? `Your ${kind} has been removed.`
        : `Your ${kind} has been updated.`,
      title: remove ? "Removed" : "Updated",
    });
    onSaved();
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
            Update your profile details and imagery.
          </Text>
          <ScrollView
            contentContainerStyle={styles.fields}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
          >
            <ProfileMediaRow
              busy={mediaBusy === "banner"}
              kind="banner"
              onRemove={
                bannerUrl
                  ? () => {
                      void changeMedia("banner", true);
                    }
                  : undefined
              }
              onSelect={() => {
                void changeMedia("banner", false);
              }}
              progress={mediaProgress}
              url={bannerUrl}
            />
            <ProfileMediaRow
              busy={mediaBusy === "avatar"}
              kind="avatar"
              onRemove={
                avatarUrl
                  ? () => {
                      void changeMedia("avatar", true);
                    }
                  : undefined
              }
              onSelect={() => {
                void changeMedia("avatar", false);
              }}
              progress={mediaProgress}
              url={avatarUrl}
            />
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

// The bytes transferring show a percentage; once the pipeline owns the job
// (processing, scanning, publishing) there is no further number to report, so
// the label switches to what is actually happening.
function overlayLabel(progress: number): string {
  if (progress > 0 && progress < 100) {
    return `${progress}%`;
  }
  return "Processing…";
}

// Web's AvatarInput / BannerInput: the current image, a camera affordance to
// replace it, a remove control that only appears when there is something to
// remove, and the upload stage/progress overlay while the pipeline runs. The
// banner sits full width at web's 3:1 and the avatar is a 112px squircle, both
// matching the profile header they sit above.
function AvatarControls({
  busy,
  hasImage,
  onRemove,
  onSelect,
}: {
  busy: boolean;
  hasImage: boolean;
  onRemove?: () => void;
  onSelect: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.avatarActions}>
      <Pressable
        accessibilityLabel="Change profile avatar"
        accessibilityRole="button"
        disabled={busy}
        onPress={onSelect}
        style={styles.mediaButton}
      >
        <Text style={[styles.mediaButtonText, { color: theme.inputText }]}>
          {hasImage ? "Replace" : "Upload"}
        </Text>
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityLabel="Remove profile avatar"
          accessibilityRole="button"
          disabled={busy}
          onPress={onRemove}
          style={styles.mediaButton}
        >
          <Trash2 color={theme.dividerText} size={16} />
        </Pressable>
      ) : null}
    </View>
  );
}

function BannerRemove({
  busy,
  onRemove,
}: {
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel="Remove profile banner"
      accessibilityRole="button"
      disabled={busy}
      onPress={onRemove}
      style={styles.bannerRemove}
    >
      <Trash2 color="#ffffff" size={16} />
    </Pressable>
  );
}

function ProfileMediaRow({
  busy,
  kind,
  onRemove,
  onSelect,
  progress,
  url,
}: {
  busy: boolean;
  kind: ProfileImageKind;
  onRemove?: () => void;
  onSelect: () => void;
  progress: number;
  url: string | null;
}) {
  const { theme } = useAppTheme();
  const avatar = kind === "avatar";
  return (
    <View style={avatar ? styles.avatarRow : styles.bannerRow}>
      <Pressable
        accessibilityLabel={
          avatar ? "Change profile avatar" : "Change profile banner"
        }
        accessibilityRole="button"
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={onSelect}
        style={[
          avatar ? styles.avatarFrame : styles.bannerFrame,
          { borderColor: theme.cardBorder },
        ]}
      >
        {url ? (
          <Image
            contentFit="cover"
            source={{ uri: `${getApiBaseUrl()}${url}` }}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View
            style={[
              StyleSheet.absoluteFill,
              styles.placeholder,
              { backgroundColor: theme.containerBg },
            ]}
          >
            <Camera color={theme.dividerText} size={avatar ? 22 : 26} />
          </View>
        )}
        {busy ? (
          <View
            style={[
              StyleSheet.absoluteFill,
              styles.overlay,
              { backgroundColor: "rgba(0,0,0,0.55)" },
            ]}
          >
            <Text style={styles.overlayText}>{overlayLabel(progress)}</Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.max(4, Math.min(100, progress))}%` },
                ]}
              />
            </View>
          </View>
        ) : null}
      </Pressable>
      {trailingControlFor({
        avatar,
        busy,
        hasImage: Boolean(url),
        onRemove,
        onSelect,
      })}
    </View>
  );
}

// The avatar's controls sit beside it in a row; the banner's remove chip
// overlays the image itself. Built here so the row has no nested ternary, and
// the two shapes stay independently readable.
function trailingControlFor({
  avatar,
  busy,
  hasImage,
  onRemove,
  onSelect,
}: {
  avatar: boolean;
  busy: boolean;
  hasImage: boolean;
  onRemove?: () => void;
  onSelect: () => void;
}) {
  if (avatar) {
    return (
      <AvatarControls
        busy={busy}
        hasImage={hasImage}
        onRemove={onRemove}
        onSelect={onSelect}
      />
    );
  }
  if (!onRemove) {
    return null;
  }
  return <BannerRemove busy={busy} onRemove={onRemove} />;
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 10,
  },
  avatarActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  avatarFrame: {
    borderRadius: 16,
    borderWidth: 1,
    height: 112,
    overflow: "hidden",
    width: 112,
  },
  avatarRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
  },
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.55)",
    flex: 1,
    justifyContent: "flex-end",
  },
  bannerFrame: {
    borderRadius: 14,
    borderWidth: 1,
    height: 100,
    overflow: "hidden",
    width: "100%",
  },
  bannerRemove: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 999,
    height: 30,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    top: 8,
    width: 30,
  },
  bannerRow: { marginBottom: 4 },
  bio: { minHeight: 88, textAlignVertical: "top" },
  cancel: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11 },
  cancelText: { fontFamily: "SofiaProMed", fontSize: 14 },
  disabled: { opacity: 0.5 },
  fields: { gap: 8, paddingBottom: 8 },
  fill: {
    backgroundColor: "#ff9500",
    borderRadius: 99,
    height: "100%",
  },
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
  mediaButton: {
    alignItems: "center",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 34,
    minWidth: 34,
    paddingHorizontal: 12,
  },
  mediaButtonText: { fontFamily: "SofiaProMed", fontSize: 13 },
  overlay: {
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
  },
  overlayText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  placeholder: { alignItems: "center", justifyContent: "center" },
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
  track: {
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 99,
    height: 3,
    overflow: "hidden",
    width: "60%",
  },
});
