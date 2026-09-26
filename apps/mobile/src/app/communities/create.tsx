// Native port of web's create-community dialog: a five-step wizard (Topics,
// Access, Details, Accent, Imagery) over a single draft, validated against the
// server's own limits before submitting and submitted as one round trip.
//
// Imagery is uploaded on selection rather than at the end, so the community is
// created first and the uploaded ids are linked afterwards through the same
// two-phase flow web uses. A link that fails leaves a working community with
// default imagery rather than losing the whole submission.

import { useRouter } from "expo-router";
import { ArrowLeft, Check } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import {
  COMMUNITY_ACCENTS,
  COMMUNITY_LIMITS,
  COMMUNITY_TOPICS,
  COMMUNITY_TYPE_META,
  canAddTopic,
  communitySlug,
  emptyCommunityDraft,
  validateCommunityDraft,
} from "@/features/communities/lib/community-create-contract";
import type {
  CommunityAccent,
  CommunityDraft,
  CommunityTopic,
  CommunityType,
} from "@/features/communities/lib/community-create-contract";
import type { CommunityMediaSlot } from "@/features/communities/lib/community-media";
import {
  communityMediaAuth,
  linkCommunityMedia,
  uploadCommunityMedia,
} from "@/features/communities/lib/community-media";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { getApiBaseUrl } from "@/lib/api-env";
import { logInfo } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

// Dimmed when the step cannot be submitted yet, and pressed a little further
// otherwise, so the two states never read as the same affordance.
function submitOpacity(blocked: boolean, pressed: boolean): number {
  if (blocked) {
    return 0.5;
  }
  return pressed ? 0.88 : 1;
}

const STEPS = ["Topics", "Access", "Details", "Accent", "Imagery"] as const;

export default function CommunityCreateRoute() {
  const router = useRouter();
  const { isPending, user } = useSessionContext();
  const { runWithInstallToken } = useInstall();
  const { theme } = useAppTheme();
  const [draft, setDraft] = useState<CommunityDraft>(emptyCommunityDraft);
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<
    "avatar" | "banner" | null
  >(null);
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(null);
  const [bannerMediaId, setBannerMediaId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const mobileHeaderUser = user
    ? { ...user, username: user.username ?? "unknown" }
    : null;

  const patch = useCallback((changes: Partial<CommunityDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
  }, []);

  const toggleTopic = useCallback((topic: CommunityTopic) => {
    setDraft((current) => {
      let topics: CommunityTopic[];
      if (current.topics.includes(topic)) {
        topics = current.topics.filter((item) => item !== topic);
      } else if (canAddTopic(current.topics, topic)) {
        topics = [...current.topics, topic];
      } else {
        // The cap is reached and this topic is not among the chosen ones.
        return current;
      }
      return { ...current, topics };
    });
  }, []);

  // The address follows the name until the author edits it themselves, the
  // same way web derives an effective slug.
  const effectiveSlug = draft.slug || communitySlug(draft.name);

  const stepValid = useMemo(() => {
    if (step === 0) {
      return draft.topics.length > 0;
    }
    if (step === 1) {
      return Boolean(
        COMMUNITY_TYPE_META.find((item) => item.value === draft.type)
      );
    }
    if (step === 2) {
      return (
        draft.name.trim().length >= COMMUNITY_LIMITS.nameMin &&
        draft.description.trim().length > 0 &&
        communitySlug(draft.name.trim()).length > 0
      );
    }
    return true;
  }, [draft, step]);

  const pickMedia = async (slot: CommunityMediaSlot) => {
    setUploadingSlot(slot);
    setFormError(null);
    try {
      const result = await uploadCommunityMedia({
        ...(await communityMediaAuth()),
        runWithInstallToken,
        slot,
      });
      if (!result) {
        // The reader dismissed the install gate, so nothing was uploaded.
        return;
      }
      if (slot === "avatar") {
        setAvatarMediaId(result.mediaId);
      } else {
        setBannerMediaId(result.mediaId);
      }
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Couldn't upload that image"
      );
      setUploadingSlot(null);
      return;
    }
    setUploadingSlot(null);
  };

  const linkMedia = async (slug: string, slot: CommunityMediaSlot) => {
    const mediaId = slot === "avatar" ? avatarMediaId : bannerMediaId;
    if (!mediaId) {
      return;
    }
    // The community exists by now, so a failed link is logged and dropped
    // rather than thrown: losing imagery must not read as losing the community.
    await linkCommunityMedia({
      ...(await communityMediaAuth()),
      mediaId,
      slot,
      slug,
    });
  };

  const submit = async () => {
    if (!user) {
      router.push("/(auth)/login");
      return;
    }
    const problem = validateCommunityDraft({ ...draft, slug: effectiveSlug });
    if (problem) {
      setFormError(problem);
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      const cookie = await authClient.getCookie();
      const response = await fetch(
        `${getApiBaseUrl().replace(/\/+$/, "")}/api/communities`,
        {
          body: JSON.stringify({
            accentColor: draft.accentColor,
            description: draft.description.trim(),
            mature: draft.mature,
            name: draft.name.trim(),
            slug: effectiveSlug,
            topics: draft.topics,
            type: draft.type,
          }),
          headers: {
            "Content-Type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          method: "POST",
        }
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        slug?: string;
      } | null;
      if (!response.ok || !payload?.slug) {
        setFormError(payload?.error ?? "Couldn't create community");
        setPending(false);
        return;
      }
      logInfo("community_create.created", {
        slug: payload.slug,
        type: draft.type,
      });
      await Promise.all([
        linkMedia(payload.slug, "avatar"),
        linkMedia(payload.slug, "banner"),
      ]);
      router.replace({ params: { slug: payload.slug }, pathname: "/a/[slug]" });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Couldn't create community"
      );
      setPending(false);
    }
  };

  const isLastStep = step === STEPS.length - 1;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.root, { backgroundColor: theme.containerBg }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <MobileHeader user={mobileHeaderUser} />
        <View style={styles.topBar}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => (step === 0 ? router.back() : setStep(step - 1))}
            style={styles.back}
          >
            <ArrowLeft color={theme.inputText} size={21} />
          </Pressable>
          <Text style={[styles.title, { color: theme.inputText }]}>
            Create community
          </Text>
        </View>

        <View style={styles.rail}>
          {STEPS.map((label, index) => (
            <View key={label} style={styles.railItem}>
              <View
                style={[
                  styles.railBar,
                  {
                    backgroundColor:
                      index <= step ? "#f97316" : theme.cardBorder,
                  },
                ]}
              />
              <Text
                style={[
                  styles.railLabel,
                  {
                    color: index === step ? theme.inputText : theme.dividerText,
                  },
                ]}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.form}>
          {step === 0 ? (
            <>
              <Text style={[styles.label, { color: theme.inputText }]}>
                What is your community about?
              </Text>
              <Text style={[styles.hint, { color: theme.dividerText }]}>
                Pick 1 to {COMMUNITY_LIMITS.topicsMax}. Topics decide where your
                community appears.
              </Text>
              <View style={styles.chips}>
                {COMMUNITY_TOPICS.map((topic) => {
                  const chosen = draft.topics.includes(topic);
                  const enabled = canAddTopic(draft.topics, topic);
                  return (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{
                        checked: chosen,
                        disabled: !enabled,
                      }}
                      disabled={!enabled}
                      key={topic}
                      onPress={() => toggleTopic(topic)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: chosen
                            ? "rgba(249,115,22,0.16)"
                            : "transparent",
                          borderColor: chosen ? "#f97316" : theme.cardBorder,
                          opacity: enabled ? 1 : 0.4,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: chosen ? "#f97316" : theme.dividerText },
                        ]}
                      >
                        {topic}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <Text style={[styles.label, { color: theme.inputText }]}>
                Who can take part?
              </Text>
              <Text style={[styles.hint, { color: theme.dividerText }]}>
                You can change this later.
              </Text>
              {COMMUNITY_TYPE_META.map((option) => {
                const chosen = draft.type === option.value;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: chosen }}
                    key={option.value}
                    onPress={() =>
                      patch({ type: option.value as CommunityType })
                    }
                    style={[
                      styles.option,
                      {
                        borderColor: chosen ? "#f97316" : theme.cardBorder,
                      },
                    ]}
                  >
                    <View style={styles.optionText}>
                      <Text
                        style={[styles.optionLabel, { color: theme.inputText }]}
                      >
                        {option.label}
                      </Text>
                      <Text
                        style={[
                          styles.optionHint,
                          { color: theme.dividerText },
                        ]}
                      >
                        {option.description}
                      </Text>
                    </View>
                    {chosen ? <Check color="#f97316" size={18} /> : null}
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: draft.mature }}
                onPress={() => patch({ mature: !draft.mature })}
                style={[styles.option, { borderColor: theme.cardBorder }]}
              >
                <View style={styles.optionText}>
                  <Text
                    style={[styles.optionLabel, { color: theme.inputText }]}
                  >
                    Mature community
                  </Text>
                  <Text
                    style={[styles.optionHint, { color: theme.dividerText }]}
                  >
                    Marked 18+. Members see a gate before the feed.
                  </Text>
                </View>
                <View
                  style={[
                    styles.switchTrack,
                    {
                      backgroundColor: draft.mature
                        ? "#f97316"
                        : theme.cardBorder,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.switchKnob,
                      { alignSelf: draft.mature ? "flex-end" : "flex-start" },
                    ]}
                  />
                </View>
              </Pressable>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Text style={[styles.label, { color: theme.inputText }]}>
                Name
              </Text>
              <TextInput
                autoCapitalize="words"
                maxLength={COMMUNITY_LIMITS.nameMax}
                onChangeText={(value) =>
                  patch({ name: value, slug: communitySlug(value) })
                }
                placeholder="Community name"
                placeholderTextColor={theme.inputPlaceholder}
                style={[
                  styles.input,
                  { borderColor: theme.cardBorder, color: theme.inputText },
                ]}
                value={draft.name}
              />
              <Text style={[styles.label, { color: theme.inputText }]}>
                Address
              </Text>
              <View
                style={[styles.addressRow, { borderColor: theme.cardBorder }]}
              >
                <Text
                  style={[styles.addressPrefix, { color: theme.dividerText }]}
                >
                  /a/
                </Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={COMMUNITY_LIMITS.slugMax}
                  onChangeText={(value) =>
                    patch({
                      slug: value.toLowerCase().replaceAll(/[^a-z0-9_]+/g, "_"),
                    })
                  }
                  placeholder="community_address"
                  placeholderTextColor={theme.inputPlaceholder}
                  style={[styles.addressInput, { color: theme.inputText }]}
                  value={effectiveSlug}
                />
              </View>
              <Text style={[styles.label, { color: theme.inputText }]}>
                Description
              </Text>
              <TextInput
                maxLength={COMMUNITY_LIMITS.descriptionMax}
                multiline
                onChangeText={(value) => patch({ description: value })}
                placeholder="What is this community for?"
                placeholderTextColor={theme.inputPlaceholder}
                style={[
                  styles.input,
                  styles.descriptionInput,
                  { borderColor: theme.cardBorder, color: theme.inputText },
                ]}
                value={draft.description}
              />
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Text style={[styles.label, { color: theme.inputText }]}>
                Pick an accent
              </Text>
              <Text style={[styles.hint, { color: theme.dividerText }]}>
                Sets the colour of your community's badge and rails.
              </Text>
              <View style={styles.accents}>
                {COMMUNITY_ACCENTS.map((accent: CommunityAccent) => {
                  const chosen = draft.accentColor === accent;
                  return (
                    <Pressable
                      accessibilityLabel={`Accent ${accent}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: chosen }}
                      key={accent}
                      onPress={() => patch({ accentColor: accent })}
                      style={[
                        styles.accent,
                        {
                          backgroundColor: ACCENT_SWATCH[accent],
                          borderColor: chosen
                            ? theme.inputText
                            : "rgba(0,0,0,0.15)",
                        },
                      ]}
                    />
                  );
                })}
              </View>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <Text style={[styles.label, { color: theme.inputText }]}>
                Add imagery
              </Text>
              <Text style={[styles.hint, { color: theme.dividerText }]}>
                Optional. You can always change it later.
              </Text>
              <Text style={[styles.subLabel, { color: theme.dividerText }]}>
                Banner
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={uploadingSlot !== null}
                onPress={() => pickMedia("banner")}
                style={[styles.imageSlot, { borderColor: theme.cardBorder }]}
              >
                {uploadingSlot === "banner" ? (
                  <ActivityIndicator color="#f97316" />
                ) : (
                  <Text style={[styles.slotText, { color: theme.dividerText }]}>
                    {bannerMediaId ? "Replace banner" : "Choose a banner"}
                  </Text>
                )}
              </Pressable>
              <Text style={[styles.subLabel, { color: theme.dividerText }]}>
                Avatar
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={uploadingSlot !== null}
                onPress={() => pickMedia("avatar")}
                style={[
                  styles.imageSlot,
                  styles.avatarSlot,
                  { borderColor: theme.cardBorder },
                ]}
              >
                {uploadingSlot === "avatar" ? (
                  <ActivityIndicator color="#f97316" />
                ) : (
                  <Text style={[styles.slotText, { color: theme.dividerText }]}>
                    {avatarMediaId ? "Replace avatar" : "Choose an avatar"}
                  </Text>
                )}
              </Pressable>
            </>
          ) : null}

          {formError ? <Text style={styles.error}>{formError}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={pending || isPending || !stepValid}
            onPress={() => {
              if (isLastStep) {
                submit();
                return;
              }
              setStep(step + 1);
            }}
            style={({ pressed }) => [
              styles.submit,
              {
                opacity: submitOpacity(
                  pending || isPending || !stepValid,
                  pressed
                ),
              },
            ]}
          >
            {pending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.submitText}>
                {isLastStep ? "Create community" : "Continue"}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Mirrors the accent keys the server accepts, so a swatch is never a colour
// the community cannot actually take.
const ACCENT_SWATCH: Record<CommunityAccent, string> = {
  clay: "#b45309",
  denim: "#1d4ed8",
  ember: "#ea580c",
  iris: "#4f46e5",
  moss: "#4d7c0f",
  ocean: "#0e7490",
  pine: "#047857",
  plum: "#7e22ce",
  rose: "#be123c",
  sand: "#ca8a04",
  slate: "#475569",
  stone: "#78716c",
};

const styles = StyleSheet.create({
  accent: {
    borderRadius: 999,
    borderWidth: 2,
    height: 44,
    width: 44,
  },
  accents: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  addressInput: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 15,
    minHeight: 46,
    paddingVertical: 10,
  },
  addressPrefix: { fontFamily: "SofiaProReg", fontSize: 15 },
  addressRow: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 2,
    paddingHorizontal: 12,
  },
  avatarSlot: { height: 88, width: 88 },
  back: { padding: 8 },
  chip: {
    borderCurve: "continuous",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontFamily: "SofiaProReg", fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  content: { paddingBottom: 40 },
  descriptionInput: { minHeight: 104, textAlignVertical: "top" },
  error: { color: "#ffb4a6", fontFamily: "SofiaProReg", fontSize: 13 },
  form: { gap: 8, padding: 16 },
  hint: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: -4 },
  imageSlot: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderStyle: "dashed",
    borderWidth: 1,
    height: 120,
    justifyContent: "center",
  },
  input: {
    borderCurve: "continuous",
    borderRadius: 10,
    borderWidth: 1,
    fontFamily: "SofiaProReg",
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: { fontFamily: "SofiaProMed", fontSize: 13, marginTop: 8 },
  option: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    padding: 14,
  },
  optionHint: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 2 },
  optionLabel: { fontFamily: "SofiaProMed", fontSize: 14 },
  optionText: { flex: 1 },
  rail: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingTop: 14 },
  railBar: { borderCurve: "continuous", borderRadius: 999, height: 3 },
  railItem: { flex: 1, gap: 5 },
  railLabel: { fontFamily: "SofiaProReg", fontSize: 10 },
  root: { flex: 1 },
  slotText: { fontFamily: "SofiaProReg", fontSize: 13 },
  subLabel: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 12 },
  submit: {
    alignItems: "center",
    backgroundColor: "#f97316",
    borderRadius: 10,
    justifyContent: "center",
    marginTop: 20,
    minHeight: 44,
  },
  submitText: { color: "#ffffff", fontFamily: "SofiaProBold", fontSize: 14 },
  switchKnob: {
    backgroundColor: "#ffffff",
    borderRadius: 999,
    height: 20,
    width: 20,
  },
  switchTrack: {
    borderRadius: 999,
    height: 24,
    justifyContent: "center",
    padding: 2,
    width: 44,
  },
  title: { fontFamily: "SofiaProBold", fontSize: 18 },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 8,
  },
});
