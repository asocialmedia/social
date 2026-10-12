import { MenuView } from "@expo/ui/community/menu";
import { MoreHorizontal } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { premiumInput } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import {
  changeDenMember,
  searchMessageUsers,
} from "@/features/messages/lib/client";
import type {
  DenInformation,
  SearchUserResult,
} from "@/features/messages/lib/client";
import type { MessageConversationData } from "@/features/messages/lib/types";
import { getApiBaseUrl } from "@/lib/api-env";
import { orderedCopy } from "@/lib/ordered-copy";
import { useAppTheme } from "@/theme";

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
  const [people, setPeople] = useState<SearchUserResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  useEffect(() => {
    if (!adding || !query.trim()) {
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const found = await searchMessageUsers(query.trim(), {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        });
        if (active) {
          setPeople(found);
          setError(null);
        }
      } catch {
        if (active) {
          setError("Couldn't find people. Try again.");
        }
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [adding, query]);
  const mutate = async (
    targetId: string,
    action: Parameters<typeof changeDenMember>[1]["action"]
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
        { action, userId: targetId },
        { apiBase: getApiBaseUrl(), cookie: await authClient.getCookie() }
      );
      if (action === "add") {
        setQuery("");
        setPeople([]);
        setAdding(false);
      }
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
    label: string
  ) => {
    Alert.alert(
      `${label}?`,
      action === "transfer"
        ? "This member becomes the owner. You remain an Elder."
        : "This changes their access to this den. Their previous history is preserved.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            void mutate(targetId, action);
          },
          style: "destructive",
          text: label,
        },
      ]
    );
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
              setQuery("");
              setPeople([]);
            }}
          >
            <Text style={{ ...textStyle, color: "#ff9500" }}>
              {adding ? "Cancel" : "Add members"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <TextInput
        accessibilityLabel={
          adding ? "Find people to add" : "Search den members"
        }
        placeholder={adding ? "Search people you follow…" : "Search members…"}
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
      {adding
        ? people
            .filter(
              (person) =>
                person.id !== userId &&
                !members.some((member) => member.userId === person.id)
            )
            .map((person) => (
              <Pressable
                key={person.id}
                disabled={busy}
                accessibilityLabel={`Add ${person.displayName}`}
                onPress={() => {
                  void mutate(person.id, "add");
                }}
                style={{
                  alignItems: "center",
                  flexDirection: "row",
                  gap: 10,
                  paddingVertical: 8,
                }}
              >
                <UserAvatar
                  url={person.avatarUrl}
                  userId={person.id}
                  size={36}
                  radius={18}
                />
                <Text style={{ ...textStyle, flex: 1 }}>
                  {person.displayName}
                </Text>
                <Text style={{ color: "#ff9500" }}>Add</Text>
              </Pressable>
            ))
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
                    radius={18}
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
                            actions.find((option) => option.id === action)
                              ?.title ?? action
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
    </View>
  );
}
