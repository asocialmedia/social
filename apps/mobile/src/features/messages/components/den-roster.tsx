import { MenuView } from "@expo/ui/community/menu";
import { MoreHorizontal } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { StatusActionButton } from "@/components/feedback/status-action-button";
import { DialogPanel } from "@/components/surface/dialog-panel";
import { premiumInput } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { changeDenMember } from "@/features/messages/lib/client";
import type { DenInformation } from "@/features/messages/lib/client";
import {
  denBanConfirmCopy,
  denConfirmCopy,
} from "@/features/messages/lib/den-confirm";
import type { DenConfirmKind } from "@/features/messages/lib/den-confirm";
import {
  DEN_BAN_REASON_LABEL,
  DEN_BAN_REASON_MAX,
  DEN_BAN_REASON_PLACEHOLDER,
  normalizeDenBanReason,
} from "@/features/messages/lib/den-forms";
import { denAddRoom } from "@/features/messages/lib/member-picker-rules";
import type { PickerPerson } from "@/features/messages/lib/member-picker-rules";
import type { MessageConversationData } from "@/features/messages/lib/types";
import { orderedCopy } from "@/lib/format/ordered-copy";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { MemberPicker, MemberPickerSearch } from "./member-picker";

// Maps a roster menu action to its confirm-dialog kind. Bans carry a reason and
// open their own sheet; promote/demote apply immediately.
function confirmKindForAction(
  action: Parameters<typeof changeDenMember>[1]["action"]
): DenConfirmKind | null {
  if (action === "remove") {
    return "remove-member";
  }
  if (action === "transfer") {
    return "transfer-ownership";
  }
  return null;
}

export function DenRoster({
  conversation,
  information,
  userId,
  onChanged,
}: {
  conversation: MessageConversationData;
  information: DenInformation | null;
  userId: string;
  onChanged: () => void;
}) {
  const { theme, isDark } = useAppTheme();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  // The add-members picker owns its query and selection; the roster's own
  // search field keeps filtering members. Both reset when adding closes.
  const [addQuery, setAddQuery] = useState("");
  const [addSelected, setAddSelected] = useState<PickerPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Banning is the only den confirmation with a field, so it gets its own
  // sheet instead of an Alert: the reason tells the next owner what happened.
  // The sheet remounts per target (keyed below), which resets the reason
  // without flashing the previous person's.
  const [banTarget, setBanTarget] = useState<{
    displayName: string;
    userId: string;
  } | null>(null);
  const [banReason, setBanReason] = useState("");
  const pending = useRef(false);
  const field = premiumInput(isDark, false);
  const members = orderedCopy(
    conversation.members.filter((member) => !member.leftAt),
    (left, right) => {
      const ranks = { ADMIN: 1, MEMBER: 2, OWNER: 0 };
      return ranks[left.role ?? "MEMBER"] - ranks[right.role ?? "MEMBER"];
    }
  );
  const canManage = information?.canManage === true;
  const owner = information?.membership.role === "OWNER";
  // Adds every picked person, then closes the picker. One request per person:
  // the route admits members individually and reports per-id refusals.
  const addSelectedMembers = async () => {
    if (pending.current || addSelected.length === 0) {
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
      for (const person of addSelected) {
        // oxlint-disable-next-line no-await-in-loop -- membership writes must land in pick order so a partial failure leaves a predictable roster
        await changeDenMember(
          conversation.id,
          { action: "add", userId: person.id },
          options
        );
      }
      setAddQuery("");
      setAddSelected([]);
      setAdding(false);
      onChanged();
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
  const mutate = async (
    targetId: string,
    action: Parameters<typeof changeDenMember>[1]["action"],
    reason?: string | null
  ) => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await changeDenMember(
        conversation.id,
        reason === undefined
          ? { action, userId: targetId }
          : { action, reason, userId: targetId },
        { apiBase: getApiBaseUrl(), cookie: await authClient.getCookie() }
      );
      onChanged();
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
  const confirm = (
    targetId: string,
    action: Parameters<typeof changeDenMember>[1]["action"],
    memberName: string
  ) => {
    // Bans carry a reason, so they open the ban sheet instead of an Alert.
    if (action === "ban") {
      setBanReason("");
      setBanTarget({ displayName: memberName, userId: targetId });
      return;
    }
    const kind = confirmKindForAction(action);
    const copy = kind
      ? denConfirmCopy({ kind, memberName })
      : { confirmLabel: action, description: "", title: `${action}?` };
    Alert.alert(copy.title, copy.description, [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          void mutate(targetId, action);
        },
        style: "destructive",
        text: copy.confirmLabel,
      },
    ]);
  };
  const textStyle = { color: theme.inputText, fontFamily: "SofiaProMed" };
  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
        }}
      >
        <Text style={textStyle}>{members.length} members</Text>
        {canManage ? (
          <Pressable
            disabled={busy}
            onPress={() => {
              setAdding((value) => !value);
              setAddQuery("");
              setAddSelected([]);
            }}
          >
            <Text style={{ ...textStyle, color: "#ff9500" }}>
              {adding ? "Cancel" : "Add members"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {adding ? (
        <>
          <MemberPickerSearch
            onChange={setAddQuery}
            placeholder="Search people you follow…"
            value={addQuery}
          />
          <MemberPicker
            disabled={busy}
            excludeIds={members.map((member) => member.userId)}
            maxSelected={denAddRoom(members.length)}
            onToggle={(person) =>
              setAddSelected((current) => {
                if (current.some((entry) => entry.id === person.id)) {
                  return current.filter((entry) => entry.id !== person.id);
                }
                return current.length < denAddRoom(members.length)
                  ? [...current, person]
                  : current;
              })
            }
            query={addQuery}
            selectedIds={addSelected.map((person) => person.id)}
            userId={userId}
          />
          {addSelected.length > 0 ? (
            <Pressable
              accessibilityLabel={`Add ${addSelected.length} members to this den`}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                void addSelectedMembers();
              }}
              style={{ paddingVertical: 8 }}
            >
              <Text
                style={{
                  color: "#ff9500",
                  fontFamily: "SofiaProMed",
                  textAlign: "center",
                }}
              >
                {busy
                  ? "Adding…"
                  : `Add ${addSelected.length} member${addSelected.length === 1 ? "" : "s"}`}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <TextInput
          accessibilityLabel="Search den members"
          placeholder="Search members…"
          value={query}
          onChangeText={setQuery}
          editable={!busy}
          placeholderTextColor={field.placeholder}
          style={{
            backgroundColor: field.background,
            borderRadius: 12,
            boxShadow: field.shadows,
            color: field.text,
            height: 40,
            paddingHorizontal: 12,
          }}
        />
      )}
      {adding
        ? null
        : members
            .filter((member) =>
              `${member.user.displayName} ${member.user.username}`
                .toLowerCase()
                .includes(query.toLowerCase())
            )
            .map((member) => {
              const managerTarget =
                member.userId !== userId &&
                member.role !== "OWNER" &&
                (owner || member.role !== "ADMIN");
              const actions = [
                ...(owner && member.userId !== userId && member.role !== "OWNER"
                  ? [
                      {
                        id: member.role === "ADMIN" ? "demote" : "promote",
                        title:
                          member.role === "ADMIN"
                            ? "Make member"
                            : "Make Elder",
                      },
                      { id: "transfer", title: "Transfer ownership" },
                    ]
                  : []),
                ...(canManage && managerTarget
                  ? [
                      {
                        attributes: { destructive: true },
                        id: "remove",
                        title: "Remove member",
                      },
                      {
                        attributes: { destructive: true },
                        id: "ban",
                        title: "Ban member",
                      },
                    ]
                  : []),
              ].map((action) => ({
                ...action,
                attributes: {
                  ...("attributes" in action ? action.attributes : {}),
                  disabled: busy,
                },
              }));
              return (
                <View
                  key={member.userId}
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    gap: 10,
                    paddingVertical: 8,
                  }}
                >
                  <UserAvatar
                    url={member.user.avatarUrl}
                    userId={member.userId}
                    size={36}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={textStyle}>
                      {member.user.displayName}
                      {member.userId === userId ? " (you)" : ""}
                    </Text>
                    <Text style={{ color: theme.dividerText, fontSize: 12 }}>
                      @{member.user.username}
                    </Text>
                  </View>
                  {member.role === "MEMBER" ? null : (
                    <Text
                      style={{
                        color:
                          member.role === "OWNER"
                            ? "#ff9500"
                            : theme.dividerText,
                        fontSize: 12,
                      }}
                    >
                      {member.role === "OWNER" ? "Owner" : "Elder"}
                    </Text>
                  )}
                  {actions.length ? (
                    <MenuView
                      actions={actions}
                      onPressAction={({ nativeEvent }) => {
                        const action = nativeEvent.event;
                        if (action === "promote" || action === "demote") {
                          void mutate(member.userId, action);
                        }
                        if (
                          action === "remove" ||
                          action === "ban" ||
                          action === "transfer"
                        ) {
                          confirm(
                            member.userId,
                            action,
                            member.user.displayName || member.user.username
                          );
                        }
                      }}
                    >
                      <View
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel={`Manage ${member.user.displayName}`}
                        style={{ padding: 8 }}
                      >
                        <MoreHorizontal color={theme.dividerText} size={20} />
                      </View>
                    </MenuView>
                  ) : null}
                </View>
              );
            })}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.dividerText }}>
          {error}
        </Text>
      ) : null}
      {banTarget ? (
        <BanMemberDialog
          busy={busy}
          displayName={banTarget.displayName}
          key={banTarget.userId}
          onClose={() => setBanTarget(null)}
          onConfirm={(reason) => {
            const target = banTarget;
            setBanTarget(null);
            void mutate(target.userId, "ban", reason);
          }}
          reason={banReason}
          onReasonChange={setBanReason}
        />
      ) : null}
    </View>
  );
}

// The ban confirmation: the only den confirmation with a field, so it gets its
// own dialog rather than an Alert. Ported from web's DenBanDialog: the reason
// is optional, only owners and Elders read it, and the sheet remounts per
// target (keyed above) so a previous person's reason never flashes.
function BanMemberDialog({
  busy,
  displayName,
  onClose,
  onConfirm,
  onReasonChange,
  reason,
}: {
  busy: boolean;
  displayName: string;
  onClose: () => void;
  onConfirm: (reason: string | null) => void;
  onReasonChange: (value: string) => void;
  reason: string;
}) {
  const { theme, isDark } = useAppTheme();
  const copy = denBanConfirmCopy(displayName);
  const field = premiumInput(isDark, false);
  return (
    <DialogPanel
      busy={busy}
      description={copy.description}
      onClose={onClose}
      title={copy.title}
    >
      <View style={{ gap: 12 }}>
        <View style={{ gap: 4 }}>
          <Text
            style={{
              color: theme.dividerText,
              fontFamily: "SofiaProReg",
              fontSize: 12,
            }}
          >
            {DEN_BAN_REASON_LABEL}
          </Text>
          <TextInput
            accessibilityLabel="Ban reason"
            editable={!busy}
            maxLength={DEN_BAN_REASON_MAX}
            multiline
            onChangeText={onReasonChange}
            placeholder={DEN_BAN_REASON_PLACEHOLDER}
            placeholderTextColor={field.placeholder}
            style={{
              backgroundColor: field.background,
              borderRadius: 12,
              boxShadow: field.shadows,
              color: field.text,
              fontFamily: "SofiaProReg",
              minHeight: 72,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
            value={reason}
          />
        </View>
        <StatusActionButton
          disabled={busy}
          label={copy.confirmLabel}
          onPress={() => onConfirm(normalizeDenBanReason(reason))}
        />
        <Pressable
          accessibilityLabel="Cancel ban"
          accessibilityRole="button"
          disabled={busy}
          onPress={onClose}
          style={{ paddingVertical: 8 }}
        >
          <Text
            style={{
              color: theme.inputText,
              fontFamily: "SofiaProMed",
              textAlign: "center",
            }}
          >
            Cancel
          </Text>
        </Pressable>
      </View>
    </DialogPanel>
  );
}
