import { MenuView } from "@expo/ui/community/menu";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { StatusActionButton } from "@/components/feedback/status-action-button";
import { premiumInput } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { uploadMedia } from "@/features/media-upload/lib/upload-client";
import {
  changeDenMember,
  dissolveDen,
  fetchDenBans,
  renewDenInvite,
  updateDenDetails,
} from "@/features/messages/lib/client";
import type { DenInformation } from "@/features/messages/lib/client";
import type { MessageConversationData } from "@/features/messages/lib/types";
import {
  pickProfileImage,
  stabilizePickedImage,
} from "@/features/profile/lib/profile-media";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

export function DenSettings({
  conversation,
  information,
  onChanged,
  onDissolved,
}: {
  conversation: MessageConversationData;
  information: DenInformation;
  onChanged: () => void;
  onDissolved: () => void;
}) {
  const { theme, isDark } = useAppTheme();
  const [name, setName] = useState(information.den.name ?? "");
  const [description, setDescription] = useState(
    information.den.description ?? ""
  );
  const [duration, setDuration] = useState<number | null>(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [bans, setBans] = useState<
    Awaited<ReturnType<typeof fetchDenBans>>["bans"]
  >([]);
  const pending = useRef(false);
  const field = premiumInput(isDark, false);
  const text = { color: theme.inputText, fontFamily: "SofiaProMed" };
  const input = {
    backgroundColor: field.background,
    borderRadius: 12,
    boxShadow: field.shadows,
    color: field.text,
    minHeight: 40,
    paddingHorizontal: 12,
  };
  useEffect(() => {
    if (!information.canManage || revision < 0) {
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const result = await fetchDenBans(conversation.id, {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        });
        if (active) {
          setBans(result.bans);
        }
      } catch {
        if (active) {
          setError("Couldn't load banned members. Try again.");
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [conversation.id, information.canManage, revision]);
  const mutate = async (
    operation: (options: {
      apiBase: string;
      cookie: string;
    }) => Promise<unknown>,
    close = false
  ) => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation({
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      });
      onChanged();
      setRevision((value) => value + 1);
      if (close) {
        onDissolved();
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Couldn't update this den. Try again."
      );
    }
    pending.current = false;
    setBusy(false);
  };
  const photo = async () => {
    await mutate(async (options) => {
      const picked = await pickProfileImage("avatar");
      if (!picked) {
        return;
      }
      const uploaded = await uploadMedia(stabilizePickedImage(picked).source, {
        purpose: "avatar",
        waitForProcessing: true,
      });
      await updateDenDetails(
        conversation.id,
        { avatarMediaId: uploaded.mediaId },
        options
      );
    });
  };
  const renew = (kind: "link" | "code") => {
    Alert.alert(
      `Replace join ${kind}?`,
      "The current invite will stop accepting new members.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            void mutate((options) =>
              renewDenInvite(conversation.id, kind, duration, options)
            );
          },
          text: "Replace",
        },
      ]
    );
  };
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ ...text, fontFamily: "SofiaProBold" }}>
        About this den
      </Text>
      {information.canManage ? (
        <>
          <TextInput
            accessibilityLabel="Den name"
            value={name}
            onChangeText={setName}
            maxLength={64}
            editable={!busy}
            style={input}
          />
          <TextInput
            accessibilityLabel="Den description"
            placeholder="Description (optional)"
            placeholderTextColor={field.placeholder}
            value={description}
            onChangeText={setDescription}
            maxLength={280}
            editable={!busy}
            multiline
            style={{ ...input, minHeight: 72 }}
          />
          <StatusActionButton
            label="Save den details"
            disabled={busy || !name.trim()}
            onPress={() => {
              void mutate((options) =>
                updateDenDetails(
                  conversation.id,
                  {
                    description: description.trim() || null,
                    name: name.trim(),
                  },
                  options
                )
              );
            }}
          />
          <StatusActionButton
            label="Change den photo"
            disabled={busy}
            onPress={photo}
          />
          {information.den.avatarMediaId ? (
            <StatusActionButton
              label="Remove den photo"
              disabled={busy}
              onPress={() => {
                void mutate((options) =>
                  updateDenDetails(
                    conversation.id,
                    { avatarMediaId: null },
                    options
                  )
                );
              }}
            />
          ) : null}
          <Text style={{ ...text, fontFamily: "SofiaProBold" }}>
            Invite people
          </Text>
          <MenuView
            actions={[1, 7, 30, null].map((days) => ({
              id: String(days),
              state: duration === days ? "on" : "off",
              title:
                days === null
                  ? "Never expires"
                  : `${days} day${days === 1 ? "" : "s"}`,
            }))}
            onPressAction={({ nativeEvent }) => {
              setDuration(
                nativeEvent.event === "null" ? null : Number(nativeEvent.event)
              );
            }}
          >
            <Text style={{ ...text, paddingVertical: 12 }}>
              New invite expiry ·{" "}
              {duration === null ? "Never" : `${duration} days`} ▾
            </Text>
          </MenuView>
          {(["link", "code"] as const).map((kind) => {
            const value =
              kind === "link"
                ? information.den.inviteCode
                : information.den.inviteShortCode;
            return (
              <View key={kind} style={{ gap: 8 }}>
                {value ? (
                  <Pressable
                    accessibilityLabel={`Copy join ${kind}`}
                    onPress={() => {
                      void Clipboard.setStringAsync(
                        kind === "link"
                          ? `${getApiBaseUrl()}/messages/join/${encodeURIComponent(value)}`
                          : value
                      );
                    }}
                  >
                    <Text style={text}>
                      Join {kind} · {kind === "code" ? value : "Copy link"} ·
                      Copy
                    </Text>
                  </Pressable>
                ) : null}
                <StatusActionButton
                  label={value ? `Replace join ${kind}` : `Create join ${kind}`}
                  disabled={busy}
                  onPress={() => renew(kind)}
                />
              </View>
            );
          })}
          <Text style={{ ...text, fontFamily: "SofiaProBold" }}>
            Banned members
          </Text>
          {bans.length ? (
            bans.map((ban) => (
              <View
                key={ban.id}
                style={{ alignItems: "center", flexDirection: "row", gap: 12 }}
              >
                <Text style={{ ...text, flex: 1 }}>
                  {ban.displayName ?? ban.username ?? "Member"}
                </Text>
                <Pressable
                  disabled={busy}
                  onPress={() => {
                    void mutate((options) =>
                      changeDenMember(
                        conversation.id,
                        { action: "unban", userId: ban.id },
                        options
                      )
                    );
                  }}
                >
                  <Text style={{ color: "#ff9500" }}>Unban</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={{ color: theme.dividerText }}>No banned members</Text>
          )}
          {information.membership.role === "OWNER" ? (
            <StatusActionButton
              label="Dissolve den"
              disabled={busy}
              onPress={() =>
                Alert.alert(
                  "Dissolve this den?",
                  "This permanently deletes the den and its messages for everyone.",
                  [
                    { style: "cancel", text: "Cancel" },
                    {
                      onPress: () => {
                        void mutate(
                          (options) => dissolveDen(conversation.id, options),
                          true
                        );
                      },
                      style: "destructive",
                      text: "Dissolve",
                    },
                  ]
                )
              }
            />
          ) : null}
        </>
      ) : (
        <Text style={{ color: theme.dividerText }}>
          {information.den.description || "No description yet"}
        </Text>
      )}
      {error ? (
        <>
          <Text accessibilityRole="alert" style={{ color: theme.dividerText }}>
            {error}
          </Text>
          <Pressable onPress={() => setRevision((value) => value + 1)}>
            <Text style={text}>Retry</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
