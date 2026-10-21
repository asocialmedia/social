import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { StatusActionButton } from "@/components/feedback/status-action-button";
import { premiumInput } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { uploadMedia } from "@/features/media-upload/lib/upload-client";
import {
  denPersonUnavailable,
  fetchRecentDenPeople,
  createDen,
  ensureConversationKeys,
  fetchConversationDetail,
  fetchDenInvitePreview,
  joinDen,
  postConversationKeys,
  searchMessageUsers,
} from "@/features/messages/lib/client";
import type {
  DenInvitePreview,
  SearchUserResult,
} from "@/features/messages/lib/client";
import type { MessageConversationData } from "@/features/messages/lib/types";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";
import {
  pickProfileImage,
  stabilizePickedImage,
} from "@/features/profile/lib/profile-media";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { MessageSheet } from "./message-sheet";

export function DenDialog({
  mode,
  onClose,
  onOpen,
  initialCode = "",
}: {
  mode: "create" | "join";
  onClose: () => void;
  onOpen: (id: string) => void;
  initialCode?: string;
}) {
  const { theme, isDark } = useAppTheme();
  const { user } = useSessionContext();
  const { privateKey, status } = useMessagesIdentity();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState(initialCode);
  const [people, setPeople] = useState<SearchUserResult[]>([]);
  const [selected, setSelected] = useState<SearchUserResult[]>([]);
  const [preview, setPreview] = useState<DenInvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const created = useRef<MessageConversationData | null>(null);
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const handleAvatar = async () => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const picked = await pickProfileImage("avatar");
      if (picked) {
        const stable = stabilizePickedImage(picked);
        const uploaded = await uploadMedia(stable.source, {
          purpose: "avatar",
          waitForProcessing: true,
        });
        setAvatarMediaId(uploaded.mediaId);
        setAvatarUri(stable.source.uri);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Couldn't upload this photo. Try again."
      );
    }
    pending.current = false;
    setBusy(false);
  };
  const field = premiumInput(isDark, false);
  const fieldStyle = {
    backgroundColor: field.background,
    borderRadius: 12,
    boxShadow: field.shadows,
    color: field.text,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    minHeight: 40,
    paddingHorizontal: 12,
  };
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (!query.trim() && mode === "join") {
        setPeople([]);
        setPreview(null);
        return;
      }
      setChecking(true);
      setPreview(null);
      setError(null);
      try {
        const options = {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        };
        if (mode === "join") {
          const code = query.trim().split("/").at(-1) ?? query;
          const result = await fetchDenInvitePreview(code, options);
          if (active) {
            setPreview(result);
            if (result.expired) {
              setError("This invite has expired. Ask the owner for a new one.");
            } else if (result.isBanned) {
              setError("You cannot join this den.");
            }
          }
        } else {
          const result = query.trim()
            ? await searchMessageUsers(query.trim(), options, "den")
            : await fetchRecentDenPeople(user?.id ?? "", options);
          if (active) {
            setPeople(result);
          }
        }
      } catch (caughtError) {
        if (active) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Couldn't check this code. Try again."
          );
        }
      }
      if (active) {
        setChecking(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [mode, query, user?.id]);
  const handleSubmit = async () => {
    if (pending.current || !privateKey || !user) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      let id: string;
      if (mode === "create") {
        if (!created.current) {
          const result = await createDen(
            {
              avatarMediaId,
              description: description.trim(),
              memberIds: selected.map((person) => person.id),
              name: name.trim(),
            },
            options
          );
          created.current = result.conversation;
          setCreatedId(result.conversation.id);
        }
        const conversation = created.current;
        ({ id } = conversation);
        const key = await ensureConversationKeys(
          conversation,
          privateKey,
          user.id,
          {
            postKeys: (target, keys) =>
              postConversationKeys(target, keys, options),
            refreshConversation: async () => {
              const detail = await fetchConversationDetail(id, options);
              return detail.conversation;
            },
          }
        );
        if (!key) {
          setError(
            "The den was created. Try again to finish setting up its messages."
          );
          pending.current = false;
          setBusy(false);
          return;
        }
      } else {
        const result = await joinDen(
          query.trim().split("/").at(-1) ?? query,
          options
        );
        id = result.conversationId;
      }
      onOpen(id);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Couldn't complete this. Please try again."
      );
    }
    pending.current = false;
    setBusy(false);
  };
  const canSubmit =
    status === "ready" &&
    !busy &&
    (mode === "create"
      ? name.trim().length >= 1 && selected.length > 0
      : Boolean(preview && !preview.expired && !preview.isBanned));
  let submitLabel = preview?.isMember ? "Open den" : "Join den";
  if (mode === "create") {
    submitLabel = "Create den";
  }
  if (busy) {
    submitLabel = "Please wait…";
  }
  return (
    <MessageSheet
      title={mode === "create" ? "New den" : "Join a den"}
      open
      onClose={onClose}
      busy={busy}
    >
      <Text
        style={{
          color: theme.dividerText,
          fontFamily: "SofiaProReg",
          fontSize: 14,
        }}
      >
        {mode === "create"
          ? "A den is a group conversation. Pick a name and the people you want in it."
          : "Enter an invite code to find your den."}
      </Text>
      {mode === "create" ? (
        <>
          <Pressable
            onPress={handleAvatar}
            disabled={busy || Boolean(createdId)}
            accessibilityLabel="Choose den photo"
            style={{ alignItems: "center", gap: 8 }}
          >
            {avatarUri ? (
              <Image
                source={avatarUri}
                style={{ borderRadius: 18, height: 72, width: 72 }}
              />
            ) : (
              <UserAvatar size={72} url={null} userId="new-den" />
            )}
            <Text style={{ color: theme.inputText }}>Choose photo</Text>
          </Pressable>
          <TextInput
            editable={!busy && !createdId}
            accessibilityLabel="Den name"
            placeholder="Name your den"
            maxLength={64}
            value={name}
            onChangeText={setName}
            placeholderTextColor={field.placeholder}
            style={fieldStyle}
          />
          <TextInput
            editable={!busy && !createdId}
            accessibilityLabel="Den description"
            placeholder="Description (optional)"
            maxLength={280}
            value={description}
            onChangeText={setDescription}
            placeholderTextColor={field.placeholder}
            style={[fieldStyle, { minHeight: 72 }]}
            multiline
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {selected.map((person) => (
              <Pressable
                key={person.id}
                disabled={busy || Boolean(createdId)}
                accessibilityLabel={`Remove ${person.displayName}`}
                onPress={() =>
                  setSelected((current) =>
                    current.filter((entry) => entry.id !== person.id)
                  )
                }
                style={{
                  backgroundColor: theme.containerBg,
                  borderRadius: 999,
                  padding: 8,
                }}
              >
                <Text
                  style={{ color: theme.inputText, fontFamily: "SofiaProMed" }}
                >
                  {person.displayName} ×
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <TextInput
        accessibilityLabel={
          mode === "create" ? "Find den members" : "Den invite code"
        }
        placeholder={mode === "create" ? "Search people…" : "Enter invite code"}
        value={query}
        onChangeText={setQuery}
        autoCapitalize={mode === "join" ? "characters" : "none"}
        placeholderTextColor={field.placeholder}
        style={fieldStyle}
      />
      {checking ? (
        <Text style={{ color: theme.dividerText }}>Checking…</Text>
      ) : null}
      {mode === "create"
        ? people.map((person) => (
            <Pressable
              disabled={
                busy ||
                Boolean(createdId) ||
                Boolean(denPersonUnavailable(person))
              }
              accessibilityLabel={`Select ${person.displayName}`}
              key={person.id}
              onPress={() =>
                setSelected((current) => {
                  if (current.some((entry) => entry.id === person.id)) {
                    return current.filter((entry) => entry.id !== person.id);
                  }
                  return current.length < 99 ? [...current, person] : current;
                })
              }
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: 10,
                paddingVertical: 8,
              }}
            >
              <UserAvatar size={36} url={person.avatarUrl} userId={person.id} />
              <Text
                style={{
                  color: theme.inputText,
                  flex: 1,
                  fontFamily: "SofiaProMed",
                }}
              >
                {person.displayName}
                {denPersonUnavailable(person)
                  ? ` · ${denPersonUnavailable(person)}`
                  : ""}
              </Text>
              <Text style={{ color: theme.inputText }}>
                {selected.some((entry) => entry.id === person.id) ? "✓" : "+"}
              </Text>
            </Pressable>
          ))
        : null}
      {mode === "join" && preview ? (
        <View style={{ gap: 4 }}>
          <Text
            style={{
              color: theme.inputText,
              fontFamily: "SofiaProBold",
              fontSize: 20,
            }}
          >
            {preview.den.name ?? "Den"}
          </Text>
          <Text style={{ color: theme.dividerText }}>
            {preview.den.memberCount} members
          </Text>
        </View>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: isDark ? "#ff8a80" : "#dc2626",
            fontFamily: "SofiaProReg",
          }}
        >
          {error}
        </Text>
      ) : null}
      <StatusActionButton
        disabled={!canSubmit}
        label={submitLabel}
        onPress={handleSubmit}
      />
    </MessageSheet>
  );
}
