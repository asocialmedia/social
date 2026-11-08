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
  createConversation,
  createDen,
  ensureConversationKeys,
  fetchConversationDetail,
  fetchDenInvitePreview,
  joinDen,
  MessagesApiError,
  postConversationKeys,
} from "@/features/messages/lib/client";
import type { DenInvitePreview } from "@/features/messages/lib/client";
import {
  DEN_LIMITS,
  validateDenDescription,
  validateDenName,
} from "@/features/messages/lib/den-forms";
import {
  denJoinActionLabel,
  denJoinDescription,
  denJoinFailure,
  denJoinFailureCopy,
  denJoinOutcome,
  denJoinTitle,
} from "@/features/messages/lib/den-invite";
import type { DenJoinFailure } from "@/features/messages/lib/den-invite";
import { HistoryThrottledError } from "@/features/messages/lib/history-throttle";
import { denCreateRoom } from "@/features/messages/lib/member-picker-rules";
import type { PickerPerson } from "@/features/messages/lib/member-picker-rules";
import type { MessageConversationData } from "@/features/messages/lib/types";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";
import {
  pickProfileImage,
  stabilizePickedImage,
} from "@/features/profile/lib/profile-media";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { MemberPicker, MemberPickerSearch } from "./member-picker";
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
  const [selected, setSelected] = useState<PickerPerson[]>([]);
  const [preview, setPreview] = useState<DenInvitePreview | null>(null);
  // A refused join preview or press. The banner error below stays for
  // create-mode failures; join-mode failures render the failure screen copy.
  const [joinFailure, setJoinFailure] = useState<DenJoinFailure | null>(null);
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
    // Create mode fetching lives in MemberPicker; this effect only resolves
    // join-code previews.
    if (mode === "create") {
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        setPreview(null);
        return;
      }
      setChecking(true);
      setPreview(null);
      setJoinFailure(null);
      setError(null);
      try {
        const options = {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        };
        // Links are lowercase and unambiguous; a pasted code is normalized the
        // same way the server normalizes before comparing.
        const code = query.trim().toLowerCase().split("/").at(-1) ?? query;
        const result = await fetchDenInvitePreview(code, options);
        if (active) {
          setPreview(result);
        }
      } catch (caughtError) {
        if (active) {
          if (caughtError instanceof HistoryThrottledError) {
            setJoinFailure("rate-limited");
          } else if (caughtError instanceof MessagesApiError) {
            const failure = denJoinFailure(
              caughtError.status,
              caughtError.code
            );
            // A preview refusal is a state, not a banner: the screen says the
            // dead end rather than erroring.
            setJoinFailure(failure);
            if (failure === "unavailable") {
              setError("Couldn't check this code. Try again.");
            }
          } else {
            setError(
              caughtError instanceof Error
                ? caughtError.message
                : "Couldn't check this code. Try again."
            );
          }
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
  }, [mode, query]);
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
        // The POST succeeds for members too, answering the same conversation,
        // so opening it is the whole outcome for both joinable and
        // already-member.
        const code = query.trim().toLowerCase().split("/").at(-1) ?? query;
        try {
          const result = await joinDen(code, options);
          id = result.conversationId;
        } catch (pressError) {
          if (pressError instanceof HistoryThrottledError) {
            setJoinFailure("rate-limited");
          } else if (pressError instanceof MessagesApiError) {
            setJoinFailure(denJoinFailure(pressError.status, pressError.code));
          } else {
            setError(
              pressError instanceof Error
                ? pressError.message
                : "Couldn't complete this. Please try again."
            );
          }
          pending.current = false;
          setBusy(false);
          return;
        }
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
  // Ask the den's owner for a new invite: open (or create) the DM first, so a
  // refusal is answered while this screen is still on the stack. The deep link
  // the messages page reads then finds the same conversation.
  const handleAskOwner = async () => {
    const ownerId = preview?.den.ownerId;
    if (!ownerId || !user || pending.current) {
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
      const { conversation } = await createConversation(ownerId, options);
      onOpen(conversation.id);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Couldn't open a chat with the owner. Try again."
      );
    }
    pending.current = false;
    setBusy(false);
  };
  // The join screen's state, decided from the preview before anybody commits.
  // Null until a code resolves; full is decided here from the member count,
  // and the POST can only confirm or refuse.
  const outcome =
    mode === "join" && !joinFailure ? denJoinOutcome({ preview }) : null;
  const joinAction = outcome ? denJoinActionLabel(outcome, busy) : null;
  // Name/description rules mirror web's create-den-dialog through the shared
  // den-forms validators, so a refusal the server would make is said here.
  const nameError =
    mode === "create" && name.length > 0 ? validateDenName(name) : null;
  const descriptionError =
    mode === "create" && description.length > 0
      ? validateDenDescription(description)
      : null;
  const canSubmit =
    status === "ready" &&
    !busy &&
    (mode === "create"
      ? validateDenName(name) === null &&
        selected.length > 0 &&
        !descriptionError
      : joinAction !== null);
  let submitLabel = "Join den";
  if (mode === "create") {
    submitLabel = "Create den";
  } else if (joinAction) {
    submitLabel = joinAction;
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
            maxLength={DEN_LIMITS.nameMax}
            value={name}
            onChangeText={setName}
            placeholderTextColor={field.placeholder}
            style={fieldStyle}
          />
          {nameError ? (
            <Text
              accessibilityRole="alert"
              style={{ color: theme.errorBannerText }}
            >
              {nameError}
            </Text>
          ) : (
            <Text style={{ color: theme.dividerText, fontSize: 12 }}>
              {name.trim().length}/{DEN_LIMITS.nameMax}
            </Text>
          )}
          <TextInput
            editable={!busy && !createdId}
            accessibilityLabel="Den description"
            placeholder="Description (optional)"
            maxLength={DEN_LIMITS.descriptionMax}
            value={description}
            onChangeText={setDescription}
            placeholderTextColor={field.placeholder}
            style={[fieldStyle, { minHeight: 72 }]}
            multiline
          />
          {descriptionError ? (
            <Text
              accessibilityRole="alert"
              style={{ color: theme.errorBannerText }}
            >
              {descriptionError}
            </Text>
          ) : (
            <Text style={{ color: theme.dividerText, fontSize: 12 }}>
              {description.trim().length}/{DEN_LIMITS.descriptionMax}
            </Text>
          )}
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
      {mode === "create" ? (
        <MemberPickerSearch
          onChange={setQuery}
          placeholder="Search people…"
          value={query}
        />
      ) : (
        <TextInput
          accessibilityLabel="Den invite code"
          placeholder="Enter invite code"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="characters"
          placeholderTextColor={field.placeholder}
          style={fieldStyle}
        />
      )}
      {checking ? (
        <Text style={{ color: theme.dividerText }}>Checking…</Text>
      ) : null}
      {mode === "create" ? (
        <MemberPicker
          disabled={busy || Boolean(createdId)}
          excludeIds={selected.map((person) => person.id)}
          maxSelected={denCreateRoom()}
          onToggle={(person) =>
            setSelected((current) => {
              if (current.some((entry) => entry.id === person.id)) {
                return current.filter((entry) => entry.id !== person.id);
              }
              return current.length < denCreateRoom()
                ? [...current, person]
                : current;
            })
          }
          query={query}
          selectedIds={selected.map((person) => person.id)}
          userId={user?.id ?? null}
        />
      ) : null}
      {mode === "join" ? (
        <JoinState
          checking={checking}
          error={error}
          failure={joinFailure}
          onAction={onClose}
          onAskOwner={handleAskOwner}
          outcome={outcome}
          query={query}
        />
      ) : null}
      {mode === "create" && error ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: theme.errorBannerText,
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

// The join screen's body, driven by the preview outcome or a join refusal.
// Mirrors the web client-join-den states: the title and body come from
// den-invite, the submit button above only exists for joinable/already-member,
// and an expired code names the den and offers the owner.
function JoinState({
  checking,
  error,
  failure,
  onAction,
  onAskOwner,
  outcome,
  query,
}: {
  checking: boolean;
  error: string | null;
  failure: DenJoinFailure | null;
  onAction: () => void;
  onAskOwner: () => void;
  outcome: ReturnType<typeof denJoinOutcome> | null;
  query: string;
}) {
  const { theme } = useAppTheme();
  const muted = { color: theme.dividerText };
  if (checking) {
    return <Text style={muted}>Checking…</Text>;
  }
  if (failure) {
    const copy = denJoinFailureCopy(failure);
    return (
      <View style={{ gap: 4 }}>
        <JoinTitle text={copy.title} />
        <Text style={[muted, { fontFamily: "SofiaProReg", fontSize: 14 }]}>
          {copy.description}
        </Text>
        {copy.actionLabel ? (
          <Text style={{ color: theme.inputText, fontFamily: "SofiaProMed" }}>
            <Text
              accessibilityRole="link"
              onPress={onAction}
              style={{ textDecorationLine: "underline" }}
            >
              {copy.actionLabel}
            </Text>
          </Text>
        ) : null}
      </View>
    );
  }
  if (!outcome || outcome.kind === "invalid") {
    if (!query.trim()) {
      return null;
    }
    const invalid = { kind: "invalid", reason: "unknown-code" } as const;
    return (
      <View style={{ gap: 4 }}>
        <JoinTitle text={denJoinTitle(invalid)} />
        <Text style={[muted, { fontFamily: "SofiaProReg", fontSize: 14 }]}>
          {denJoinDescription(invalid)}
        </Text>
      </View>
    );
  }
  if (outcome.kind === "expired") {
    return (
      <View style={{ gap: 4 }}>
        <JoinTitle text={denJoinTitle(outcome)} />
        <Text style={[muted, { fontFamily: "SofiaProReg", fontSize: 14 }]}>
          {denJoinDescription(outcome)}
        </Text>
        {outcome.den.ownerId ? (
          <Text style={{ color: theme.inputText, fontFamily: "SofiaProMed" }}>
            <Text
              accessibilityLabel="Ask the owner for a new invite"
              accessibilityRole="link"
              onPress={onAskOwner}
              style={{ textDecorationLine: "underline" }}
            >
              Ask the owner for a new invite
            </Text>
          </Text>
        ) : null}
      </View>
    );
  }
  if (outcome.kind === "banned") {
    return (
      <View style={{ gap: 4 }}>
        <JoinTitle text={denJoinTitle(outcome)} />
        <Text style={[muted, { fontFamily: "SofiaProReg", fontSize: 14 }]}>
          {denJoinDescription(outcome)}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 4 }}>
      <JoinTitle text={outcome.den.name ?? "Den"} />
      <Text style={[muted, { fontFamily: "SofiaProReg", fontSize: 14 }]}>
        {denJoinDescription(outcome)}
      </Text>
      <Text style={[muted, { fontFamily: "SofiaProReg", fontSize: 12 }]}>
        {outcome.den.memberCount} members
      </Text>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: theme.errorBannerText,
            fontFamily: "SofiaProReg",
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function JoinTitle({ text }: { text: string }) {
  const { theme } = useAppTheme();
  return (
    <Text
      style={{
        color: theme.inputText,
        fontFamily: "SofiaProBold",
        fontSize: 20,
      }}
    >
      {text}
    </Text>
  );
}
