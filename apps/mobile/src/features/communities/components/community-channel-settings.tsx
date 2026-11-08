// Native port of web CommunityChannelSettings
// (components/communities/page/community-channel-settings.tsx): the staff
// form for a channel's name, topic, slow mode, position, announcement mode
// and lock, plus a two-step archive. Opened from the chat details sheet.
import type { CommunityChatRoom } from "@asm/messages";
import { Settings2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { DialogPanel } from "@/components/surface/dialog-panel";
import { metaChip } from "@/components/surface/recipes";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import {
  SettingsButton,
  SettingsInput,
  SettingsSubcard,
  SettingsSwitch,
} from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

import {
  COMMUNITY_SLOW_MODE_OPTIONS,
  communityChannelSettingsDraft,
  slowModeLabel,
  updateCommunityChatChannel,
} from "../lib/community-chat-api";
import type { CommunityChannelSettingsDraft } from "../lib/community-chat-api";

export function CommunityChannelSettingsButton({
  canArchive,
  onUpdated,
  options,
  room,
  slug,
}: {
  canArchive: boolean;
  onUpdated: (channel: CommunityChatRoom) => void;
  options: () => Promise<ApiCallOptions>;
  room: CommunityChatRoom;
  slug: string;
}) {
  const { isDark, theme } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CommunityChannelSettingsDraft>(() =>
    communityChannelSettingsDraft(room)
  );
  const [positionText, setPositionText] = useState(String(room.sortOrder));
  const [saving, setSaving] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const chip = metaChip(isDark);

  const update = (patch: Partial<CommunityChannelSettingsDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const save = async (archived: boolean) => {
    setSaving(true);
    setRequestError(null);
    try {
      const channel = await updateCommunityChatChannel(
        slug,
        room.id,
        draft,
        archived,
        await options()
      );
      onUpdated(channel);
      setOpen(false);
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "Couldn't save this channel"
      );
    }
    setSaving(false);
  };

  return (
    <>
      <Pressable
        accessibilityLabel="Channel settings"
        accessibilityRole="button"
        onPress={() => {
          // Reset to the room's current values every time, like web's trigger.
          setDraft(communityChannelSettingsDraft(room));
          setPositionText(String(room.sortOrder));
          setRequestError(null);
          setConfirmArchive(false);
          setOpen(true);
        }}
        style={styles.trigger}
      >
        <Settings2 color={theme.inputText} size={16} />
        <Text style={[styles.triggerText, { color: theme.inputText }]}>
          Channel settings
        </Text>
      </Pressable>
      {open ? (
        <DialogPanel
          busy={saving}
          description="Shape this channel for your community."
          onClose={() => setOpen(false)}
          title={`${room.name} settings`}
        >
          <View style={styles.form}>
            <SettingsInput
              autoCapitalize="none"
              label="Channel name"
              maxLength={64}
              onChangeText={(name) => update({ name })}
              value={draft.name}
            />
            <SettingsInput
              autoCapitalize="sentences"
              label="Topic"
              maxLength={500}
              multiline
              onChangeText={(topic) => update({ topic })}
              placeholder="What happens in this channel?"
              value={draft.topic}
            />
            <View>
              <Text style={[styles.label, { color: theme.dividerText }]}>
                Slow mode
              </Text>
              <View accessibilityRole="radiogroup" style={styles.choices}>
                {COMMUNITY_SLOW_MODE_OPTIONS.map((seconds) => {
                  const selected = draft.slowModeSeconds === seconds;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={seconds}
                      onPress={() => update({ slowModeSeconds: seconds })}
                      style={[
                        styles.choice,
                        {
                          backgroundColor: selected
                            ? "#ff9500"
                            : chip.background,
                          borderColor: selected ? "#e65500" : chip.border,
                          boxShadow: chip.shadows,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.choiceText,
                          { color: selected ? "#ffffff" : theme.inputText },
                        ]}
                      >
                        {slowModeLabel(seconds)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <SettingsInput
              keyboardType="numeric"
              label="Channel position"
              maxLength={4}
              onChangeText={(text) => {
                const digits = text.replaceAll(/\D/g, "");
                setPositionText(digits);
                update({ position: digits ? Number(digits) : 0 });
              }}
              value={positionText}
            />
            <SettingsSubcard style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <Text style={[styles.toggleTitle, { color: theme.inputText }]}>
                  Announcement channel
                </Text>
                <Text style={[styles.hint, { color: theme.dividerText }]}>
                  Only owners and moderators can post.
                </Text>
              </View>
              <SettingsSwitch
                accessibilityLabel="Announcement channel"
                onValueChange={(announcement) => update({ announcement })}
                value={draft.announcement}
              />
            </SettingsSubcard>
            <SettingsSubcard style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <Text style={[styles.toggleTitle, { color: theme.inputText }]}>
                  Lock channel
                </Text>
                <Text style={[styles.hint, { color: theme.dividerText }]}>
                  Keep history available and pause new messages.
                </Text>
              </View>
              <SettingsSwitch
                accessibilityLabel="Lock channel"
                onValueChange={(locked) => update({ locked })}
                value={draft.locked}
              />
            </SettingsSubcard>
            {requestError ? (
              <Text
                accessibilityRole="alert"
                style={[
                  styles.error,
                  { color: isDark ? "#ff6b6b" : "#dc2626" },
                ]}
              >
                {requestError}
              </Text>
            ) : null}
            <SettingsButton
              block
              disabled={saving || !draft.name.trim()}
              label={saving ? "Saving…" : "Save changes"}
              onPress={() => {
                void save(false);
              }}
            />
            <View
              style={[styles.archive, { borderTopColor: theme.cardBorder }]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !canArchive || saving }}
                disabled={!canArchive || saving}
                onPress={() => {
                  if (confirmArchive) {
                    void save(true);
                  } else {
                    setConfirmArchive(true);
                  }
                }}
                style={[
                  styles.archiveButton,
                  (!canArchive || saving) && styles.disabled,
                ]}
              >
                <Text
                  style={[
                    styles.archiveText,
                    { color: isDark ? "#ff6b6b" : "#dc2626" },
                  ]}
                >
                  {confirmArchive
                    ? "Confirm archive channel"
                    : "Archive channel"}
                </Text>
              </Pressable>
              <Text style={[styles.hint, { color: theme.dividerText }]}>
                {canArchive
                  ? "Archived channels keep their history and stop accepting messages."
                  : "Keep at least one channel available for the community."}
              </Text>
            </View>
          </View>
        </DialogPanel>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  archive: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingTop: 12,
  },
  archiveButton: {
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: 44,
  },
  archiveText: { fontFamily: "SofiaProMed", fontSize: 14 },
  choice: {
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 12,
  },
  choiceText: { fontFamily: "SofiaProMed", fontSize: 12 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  disabled: { opacity: 0.5 },
  error: { fontFamily: "SofiaProReg", fontSize: 14 },
  form: { gap: 16 },
  hint: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 17 },
  label: { fontFamily: "SofiaProMed", fontSize: 14 },
  toggleCopy: { flex: 1, minWidth: 0 },
  toggleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
    padding: 12,
  },
  toggleTitle: { fontFamily: "SofiaProMed", fontSize: 14 },
  trigger: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  triggerText: { fontFamily: "SofiaProMed", fontSize: 14 },
});
