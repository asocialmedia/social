import {
  COMMUNITY_ACCENTS as accentOptions,
  COMMUNITY_TOPICS as topicOptions,
} from "@asm/db/communities";
import { Image } from "expo-image";
import { ArrowLeft, ArrowRight, Camera, Check, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScrollViewInstance } from "react-native";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toast } from "@/components/feedback/toast";
import { IconButton3D } from "@/components/surface/icon-button-3d";
import { panel3d, themeText } from "@/components/surface/recipes";
import { useInstall } from "@/features/auth/state/install";
import { useProfileMediaCropper } from "@/features/profile/components/profile-media-cropper";
import {
  SettingsButton,
  SettingsInput,
} from "@/features/settings/components/settings-ui";
import { logWarn } from "@/lib/lifecycle/telemetry";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { withAuthHeaders } from "@/lib/network/auth-headers";
import {
  NAV_ACTIVE_SHADOWS,
  NAV_ACTIVE_SHADOWS_DARK,
  SURFACE_SHADOWS,
  SURFACE_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import { resolveCommunityAccentColor } from "../lib/community-accents";
import { createCommunity } from "../lib/community-create-api";
import {
  COMMUNITY_LIMITS,
  COMMUNITY_TYPE_META,
  canAddTopic,
  validateCommunityDraft,
} from "../lib/community-create-contract";
import type { CommunityTopic } from "../lib/community-create-contract";
import {
  communityMediaAuth,
  linkCommunityMedia,
  uploadCommunityMedia,
} from "../lib/community-media";
import type { CommunityMediaSlot } from "../lib/community-media";
import {
  COMMUNITY_CREATE_STEPS,
  emptyCommunityWizard,
  wizardSlug,
  wizardStepValid,
} from "../lib/community-wizard";
import type { CommunityWizardDraft } from "../lib/community-wizard";
import {
  clearCommunityWizard,
  readCommunityWizard,
  saveCommunityWizard,
} from "../lib/community-wizard-native";
import { CommunityCreatePreview } from "./community-create-preview";

export function CommunityCreateDialog({
  userId,
  onClose,
  onCreated,
}: {
  userId: string;
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const { theme, isDark } = useAppTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { runWithInstallToken } = useInstall();
  const { crop, cropper } = useProfileMediaCropper();
  const [draft, setDraft] = useState<CommunityWizardDraft>(
    () => readCommunityWizard(userId) ?? emptyCommunityWizard()
  );
  const [pending, setPending] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<CommunityMediaSlot | null>(
    null
  );
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [avatarLocal, setAvatarLocal] = useState<string | null>(null);
  const [bannerLocal, setBannerLocal] = useState<string | null>(null);
  const [mediaHeaders, setMediaHeaders] = useState<Record<
    string,
    string
  > | null>(null);
  const completed = useRef(false);
  const submission = useRef(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const panel = panel3d(isDark);
  const busy = pending || uploadingSlot !== null;
  const avatarPreview =
    avatarLocal ??
    (draft.avatarMediaId && mediaHeaders
      ? `${getApiBaseUrl()}/api/media/${encodeURIComponent(draft.avatarMediaId)}`
      : null);
  const bannerPreview =
    bannerLocal ??
    (draft.bannerMediaId && mediaHeaders
      ? `${getApiBaseUrl()}/api/media/${encodeURIComponent(draft.bannerMediaId)}`
      : null);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!userId) {
        return;
      }
      try {
        const { cookie } = await communityMediaAuth();
        if (active) {
          setMediaHeaders(withAuthHeaders({}, cookie));
        }
      } catch {
        // Local imagery remains usable if session storage is unavailable.
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);
  useEffect(() => {
    if (!completed.current) {
      saveCommunityWizard(userId, draft);
    }
  }, [draft, userId]);
  const patch = useCallback((changes: Partial<CommunityWizardDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setFormError(null);
  }, []);
  const moveStep = (step: number) => {
    Keyboard.dismiss();
    patch({ step });
    scrollRef.current?.scrollTo({ animated: false, y: 0 });
  };
  const close = () => {
    if (!busy) {
      saveCommunityWizard(userId, draft);
      onClose();
    }
  };
  const toggleTopic = (topic: CommunityTopic) => {
    if (draft.topics.includes(topic)) {
      patch({ topics: draft.topics.filter((value) => value !== topic) });
    } else if (canAddTopic(draft.topics, topic)) {
      patch({ topics: [...draft.topics, topic] });
    }
  };

  const pickMedia = async (slot: CommunityMediaSlot) => {
    if (busy) {
      return;
    }
    setUploadingSlot(slot);
    setUploadProgress(0);
    setUploadStage(null);
    setFormError(null);
    try {
      const uploaded = await uploadCommunityMedia({
        ...(await communityMediaAuth()),
        callbacks: { onBytes: setUploadProgress, onStage: setUploadStage },
        crop,
        runWithInstallToken,
        slot,
      });
      if (uploaded) {
        const { source } = uploaded;
        const uri =
          typeof source === "object" && "uri" in source
            ? (source.uri ?? null)
            : null;
        if (slot === "avatar") {
          patch({ avatarMediaId: uploaded.mediaId });
          setAvatarLocal(uri);
        } else {
          patch({ bannerMediaId: uploaded.mediaId });
          setBannerLocal(uri);
        }
      }
    } catch (error) {
      logWarn("community_create.media_failed", {
        reason: error instanceof Error ? error.message : "unknown",
        slot,
      });
      setFormError(
        "We couldn’t upload that image. Try a JPG, PNG, or GIF under 10MB."
      );
    }
    setUploadingSlot(null);
  };
  const submit = async () => {
    if (busy || submission.current) {
      return;
    }
    const values = {
      accentColor: draft.accentColor,
      description: draft.description.trim(),
      mature: draft.mature,
      name: draft.name.trim(),
      slug: wizardSlug(draft),
      topics: draft.topics,
      type: draft.type,
    };
    const problem = validateCommunityDraft(values);
    if (problem) {
      setFormError(problem);
      return;
    }
    submission.current = true;
    setPending(true);
    setFormError(null);
    try {
      const result = await runWithInstallToken(
        () =>
          communityMediaAuth().then((options) =>
            createCommunity(values, options)
          ),
        (value) => value.kind === "install-token-required"
      );
      if (result?.kind === "success") {
        const options = await communityMediaAuth();
        const linked = await Promise.all(
          (["avatar", "banner"] as const).map((slot) => {
            const mediaId =
              slot === "avatar" ? draft.avatarMediaId : draft.bannerMediaId;
            return mediaId
              ? linkCommunityMedia({
                  ...options,
                  mediaId,
                  slot,
                  slug: result.slug,
                })
              : Promise.resolve(true);
          })
        );
        completed.current = true;
        clearCommunityWizard(userId);
        toast({
          description: linked.every(Boolean)
            ? "Your new space is ready."
            : "Your community is ready. You can retry its imagery in settings.",
          title: "Community created",
        });
        onCreated(result.slug);
      } else if (result?.kind === "error") {
        setFormError(result.message);
      }
    } catch (error) {
      logWarn("community_create.failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      setFormError(
        "We couldn’t finish creating your community. Your draft is saved."
      );
    }
    submission.current = false;
    setPending(false);
  };
  const last = draft.step === COMMUNITY_CREATE_STEPS.length - 1;
  let forwardLabel = last ? "Create community" : "Next";
  if (uploadingSlot) {
    forwardLabel = "Uploading…";
  }
  const selectedShadows = isDark ? NAV_ACTIVE_SHADOWS_DARK : NAV_ACTIVE_SHADOWS;
  const surface = {
    backgroundColor: theme.cardBg,
    borderColor: theme.cardBorder,
    boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
  };
  return (
    <>
      <Modal
        animationType="fade"
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        visible
        onRequestClose={close}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={[
            styles.backdrop,
            {
              paddingBottom: Math.max(16, insets.bottom),
              paddingTop: Math.max(16, insets.top),
            },
          ]}
        >
          <Pressable
            accessibilityLabel="Close community creation"
            disabled={busy}
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.panel,
              {
                backgroundColor: panel.background,
                borderColor: panel.border,
                boxShadow: panel.shadows,
                maxHeight: height * 0.9,
              },
            ]}
          >
            <View
              style={[styles.header, { borderBottomColor: theme.cardBorder }]}
            >
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: theme.inputText }]}
              >
                Create a community
              </Text>
              <View
                accessible
                accessibilityLabel={`Step ${draft.step + 1} of 5: ${COMMUNITY_CREATE_STEPS[draft.step]}`}
                style={styles.rail}
              >
                {COMMUNITY_CREATE_STEPS.map((step, index) => (
                  <View
                    key={step}
                    style={[
                      styles.bar,
                      {
                        backgroundColor:
                          index <= draft.step ? "#f97316" : theme.cardBorder,
                        opacity: index < draft.step ? 0.5 : 1,
                        width: index === draft.step ? 20 : 10,
                      },
                    ]}
                  />
                ))}
              </View>
              <IconButton3D
                accessibilityLabel="Close community creation"
                disabled={busy}
                icon={X}
                onPress={close}
                size={28}
              />
            </View>
            <ScrollView
              ref={scrollRef}
              style={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.form}>
                {draft.step === 0 ? (
                  <>
                    <StepHeading
                      title="What is your community about?"
                      hint="Pick up to 5 so people can find it."
                    />
                    <View style={styles.chips}>
                      {topicOptions.map((topic) => {
                        const chosen = draft.topics.includes(
                          topic.key as CommunityTopic
                        );
                        const disabled = !canAddTopic(
                          draft.topics,
                          topic.key as CommunityTopic
                        );
                        return (
                          <Pressable
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: chosen, disabled }}
                            disabled={disabled}
                            key={topic.key}
                            onPress={() =>
                              toggleTopic(topic.key as CommunityTopic)
                            }
                            style={[
                              styles.chip,
                              chosen
                                ? {
                                    backgroundColor: "#f973161a",
                                    borderColor: "#f9731640",
                                    boxShadow: isDark
                                      ? NAV_ACTIVE_SHADOWS_DARK
                                      : NAV_ACTIVE_SHADOWS,
                                  }
                                : { borderColor: "transparent" },
                              disabled && { opacity: 0.4 },
                            ]}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                {
                                  color: chosen ? "#f97316" : theme.dividerText,
                                },
                              ]}
                            >
                              {topic.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={[styles.hint, { color: theme.dividerText }]}>
                      {draft.topics.length}/5 selected
                    </Text>
                  </>
                ) : null}
                {draft.step === 1 ? (
                  <>
                    <StepHeading
                      title="Who can take part?"
                      hint="Only public communities appear in search."
                    />
                    {COMMUNITY_TYPE_META.map((option) => (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityState={{
                          checked: draft.type === option.value,
                        }}
                        onPress={() => patch({ type: option.value })}
                        style={[
                          styles.option,
                          surface,
                          draft.type === option.value && {
                            borderColor: "#f9731640",
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.radio,
                            {
                              backgroundColor: theme.containerBg,
                              borderColor:
                                draft.type === option.value
                                  ? "#f97316"
                                  : theme.cardBorder,
                            },
                          ]}
                        >
                          {draft.type === option.value ? (
                            <View style={styles.radioDot} />
                          ) : null}
                        </View>
                        <View style={styles.optionCopy}>
                          <Text
                            style={[styles.label, { color: theme.inputText }]}
                          >
                            {option.label}
                          </Text>
                          <Text
                            style={[styles.hint, { color: theme.dividerText }]}
                          >
                            {option.description}
                          </Text>
                        </View>
                      </Pressable>
                    ))}
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: draft.mature }}
                      onPress={() => patch({ mature: !draft.mature })}
                      style={[styles.option, surface]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            backgroundColor: draft.mature
                              ? "#f97316"
                              : theme.containerBg,
                            borderColor: theme.cardBorder,
                          },
                        ]}
                      >
                        {draft.mature ? (
                          <Check color="#ffffff" size={13} />
                        ) : null}
                      </View>
                      <View style={styles.optionCopy}>
                        <Text
                          style={[styles.label, { color: theme.inputText }]}
                        >
                          Mature (18+)
                        </Text>
                        <Text
                          style={[styles.hint, { color: theme.dividerText }]}
                        >
                          Viewers must be over 18
                        </Text>
                      </View>
                    </Pressable>
                  </>
                ) : null}
                {draft.step === 2 ? (
                  <>
                    <SettingsInput
                      label="Name"
                      maxLength={COMMUNITY_LIMITS.nameMax}
                      placeholder="Hackers"
                      value={draft.name}
                      onChangeText={(name) => patch({ name })}
                    />
                    <Text style={[styles.hint, { color: theme.dividerText }]}>
                      {draft.name.length}/21
                    </Text>
                    <SettingsInput
                      label="Address"
                      leadingText="a/"
                      maxLength={COMMUNITY_LIMITS.slugMax}
                      placeholder="hackers"
                      value={wizardSlug(draft)}
                      onChangeText={(slug) =>
                        patch({ slug: slug.toLowerCase(), slugTouched: true })
                      }
                    />
                    <Text style={[styles.hint, { color: theme.dividerText }]}>
                      Lowercase letters, numbers, underscores. Cannot be changed
                      later.
                    </Text>
                    <SettingsInput
                      label="Description"
                      multiline
                      maxLength={COMMUNITY_LIMITS.descriptionMax}
                      placeholder="A place for builders, tinkerers, and the terminally curious."
                      value={draft.description}
                      onChangeText={(description) => patch({ description })}
                    />
                    <Text style={[styles.hint, { color: theme.dividerText }]}>
                      {draft.description.length}/500
                    </Text>
                  </>
                ) : null}
                {draft.step === 3 ? (
                  <>
                    <StepHeading
                      title="Pick an accent"
                      hint="Marks posts from this community across every feed."
                    />
                    <View style={styles.chips}>
                      {accentOptions.map((accent) => {
                        const chosen = draft.accentColor === accent.key;
                        return (
                          <Pressable
                            accessibilityRole="radio"
                            accessibilityState={{ checked: chosen }}
                            key={accent.key}
                            onPress={() =>
                              patch({
                                accentColor:
                                  accent.key as CommunityWizardDraft["accentColor"],
                              })
                            }
                            style={[
                              styles.chip,
                              styles.accentChip,
                              {
                                backgroundColor: chosen
                                  ? "#f973161a"
                                  : "transparent",
                                borderColor: chosen
                                  ? "#f9731640"
                                  : "transparent",
                                boxShadow: chosen ? selectedShadows : undefined,
                              },
                            ]}
                          >
                            <View
                              style={[
                                styles.swatch,
                                {
                                  backgroundColor: resolveCommunityAccentColor(
                                    accent.key,
                                    isDark
                                  ),
                                },
                              ]}
                            />
                            <Text
                              style={[
                                styles.chipText,
                                {
                                  color: chosen ? "#f97316" : theme.dividerText,
                                },
                              ]}
                            >
                              {accent.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}
                {draft.step === 4 ? (
                  <>
                    <StepHeading
                      title="Add imagery"
                      hint="Optional. JPG, PNG, or GIF under 10MB."
                    />
                    <View style={[styles.imagery, surface]}>
                      <Pressable
                        accessibilityLabel="Choose community banner"
                        disabled={busy}
                        onPress={() => {
                          void pickMedia("banner");
                        }}
                        style={[
                          styles.bannerInput,
                          { backgroundColor: theme.containerBg },
                        ]}
                      >
                        {bannerPreview ? (
                          <Image
                            source={{
                              headers: mediaHeaders ?? undefined,
                              uri: bannerPreview,
                            }}
                            contentFit="cover"
                            style={StyleSheet.absoluteFill}
                          />
                        ) : (
                          <Camera color={theme.dividerText} size={24} />
                        )}
                        {uploadingSlot === "banner" ? (
                          <ActivityIndicator color="#f97316" />
                        ) : null}
                      </Pressable>
                      {draft.bannerMediaId ? (
                        <View style={styles.bannerRemove}>
                          <IconButton3D
                            accessibilityLabel="Remove community banner"
                            disabled={busy}
                            icon={X}
                            onPress={() => {
                              patch({ bannerMediaId: null });
                              setBannerLocal(null);
                            }}
                            size={28}
                          />
                        </View>
                      ) : null}
                      <View style={styles.imageryBottom}>
                        <Pressable
                          accessibilityLabel="Choose community avatar"
                          disabled={busy}
                          onPress={() => {
                            void pickMedia("avatar");
                          }}
                          style={[
                            styles.avatarInput,
                            {
                              backgroundColor: theme.containerBg,
                              borderColor: theme.cardBg,
                            },
                          ]}
                        >
                          {avatarPreview ? (
                            <Image
                              source={{
                                headers: mediaHeaders ?? undefined,
                                uri: avatarPreview,
                              }}
                              contentFit="cover"
                              style={StyleSheet.absoluteFill}
                            />
                          ) : (
                            <Camera color={theme.dividerText} size={24} />
                          )}
                          {uploadingSlot === "avatar" ? (
                            <ActivityIndicator color="#f97316" />
                          ) : null}
                        </Pressable>
                        {draft.avatarMediaId ? (
                          <View style={styles.avatarRemove}>
                            <IconButton3D
                              accessibilityLabel="Remove community avatar"
                              disabled={busy}
                              icon={X}
                              onPress={() => {
                                patch({ avatarMediaId: null });
                                setAvatarLocal(null);
                              }}
                              size={24}
                            />
                          </View>
                        ) : null}
                        <Text
                          style={[
                            styles.mediaHint,
                            { color: theme.dividerText },
                          ]}
                        >
                          {uploadingSlot
                            ? `${uploadStage === "scanning" ? "Checking image" : "Uploading"} ${uploadProgress}%`
                            : "Tap the banner or icon to upload, crop, and centre."}
                        </Text>
                      </View>
                    </View>
                  </>
                ) : null}
                {formError ? (
                  <Text
                    accessibilityRole="alert"
                    style={[
                      styles.hint,
                      { color: themeText(isDark).destructive },
                    ]}
                  >
                    {formError}
                  </Text>
                ) : null}
              </View>
              <View style={[styles.preview, { backgroundColor: theme.cardBg }]}>
                <CommunityCreatePreview
                  mediaHeaders={mediaHeaders ?? undefined}
                  draft={draft}
                  avatarPreview={avatarPreview}
                  bannerPreview={bannerPreview}
                />
              </View>
            </ScrollView>
            <View style={[styles.footer, { borderTopColor: theme.cardBorder }]}>
              <SettingsButton
                label="Back"
                leadingIcon={ArrowLeft}
                radius={8}
                size="sm"
                tone="gray"
                disabled={draft.step === 0 || busy}
                onPress={() => moveStep(draft.step - 1)}
              />
              <SettingsButton
                label={forwardLabel}
                trailingIcon={last ? undefined : ArrowRight}
                radius={8}
                size="sm"
                loading={pending}
                disabled={busy || !wizardStepValid(draft)}
                onPress={() => {
                  if (last) {
                    void submit();
                  } else {
                    moveStep(draft.step + 1);
                  }
                }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {cropper}
    </>
  );
}
function StepHeading({ title, hint }: { title: string; hint: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={{ gap: 3 }}>
      <Text style={[styles.label, { color: theme.inputText }]}>{title}</Text>
      <Text style={[styles.hint, { color: theme.dividerText }]}>{hint}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  accentChip: { alignItems: "center", flexDirection: "row", gap: 8 },
  avatarInput: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 4,
    height: 96,
    justifyContent: "center",
    marginTop: -48,
    overflow: "hidden",
    width: 96,
  },
  avatarRemove: { left: 90, position: "absolute", top: -42 },
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  bannerInput: { alignItems: "center", height: 128, justifyContent: "center" },
  bannerRemove: { position: "absolute", right: 8, top: 8 },
  bar: { borderRadius: 999, height: 4 },
  checkbox: {
    alignItems: "center",
    borderRadius: 4,
    borderWidth: 1,
    height: 18,
    justifyContent: "center",
    width: 18,
  },
  chip: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontFamily: "SofiaProReg", fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  footer: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  form: { gap: 12, padding: 16 },
  header: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  hint: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 17 },
  imagery: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  imageryBottom: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 12,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  label: { fontFamily: "SofiaProMed", fontSize: 14 },
  mediaHint: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 18,
    paddingBottom: 4,
  },
  option: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionCopy: { flex: 1, gap: 2 },
  panel: {
    borderRadius: 16,
    borderWidth: 1,
    flexShrink: 1,
    maxWidth: 896,
    overflow: "hidden",
    width: "100%",
  },
  preview: { padding: 16 },
  radio: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 18,
    justifyContent: "center",
    width: 18,
  },
  radioDot: {
    backgroundColor: "#f97316",
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  rail: { alignItems: "center", flexDirection: "row", gap: 4 },
  scroll: { flexShrink: 1 },
  swatch: { borderRadius: 5, height: 14, width: 14 },
  title: { flex: 1, fontFamily: "SofiaProBold", fontSize: 16 },
});
