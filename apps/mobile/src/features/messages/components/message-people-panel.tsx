// The web's Search people and Online friends controls share this compact panel.
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import {
  createConversation,
  fetchPresenceUsers,
  searchMessageUsers,
} from "@/features/messages/lib/client";
import { panel3d, reelsInput } from "@/features/messages/lib/message-recipes";
import { conversationListStore } from "@/features/messages/state/conversation-list-store";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { PressableRow } from "./messages-primitives";

interface Person {
  avatarUrl: string | null;
  displayName: string;
  hasIdentity?: boolean;
  id: string;
  username: string;
}

export function MessagePeoplePanel({
  mode,
  onClose,
}: {
  mode: "online" | "search";
  onClose: () => void;
}) {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();
  const surface = panel3d(isDark);
  const input = reelsInput(isDark);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        try {
          const options = {
            apiBase: getApiBaseUrl(),
            cookie: await authClient.getCookie(),
          };
          let result: Person[] = [];
          if (mode === "online") {
            result = await fetchPresenceUsers(options);
          } else if (query.trim()) {
            result = await searchMessageUsers(query.trim(), options);
          }
          if (!cancelled) {
            setPeople(result);
            setError(false);
          }
        } catch {
          if (!cancelled) {
            setPeople([]);
            setError(true);
          }
        }
        if (!cancelled) {
          setLoading(false);
        }
      },
      mode === "search" ? 250 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, query]);
  const open = async (person: Person) => {
    if (opening) {
      return;
    }
    if (person.hasIdentity === false) {
      toast({
        description: `${person.displayName} hasn't enabled Messages yet`,
        title: "Can't message",
        variant: "destructive",
      });
      return;
    }
    setOpening(true);
    try {
      const existing = conversationListStore
        .getSnapshot()
        .rows.find((row) => row.peerId === person.id);
      let id = existing?.conversation.id;
      if (!id) {
        const created = await createConversation(person.id, {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        });
        const {
          conversation: { id: createdId },
        } = created;
        id = createdId;
      }
      onClose();
      router.push(`/messages/${id}`);
    } catch {
      toast({
        description: "Please try again.",
        title: "Couldn't open conversation",
        variant: "destructive",
      });
    }
    setOpening(false);
  };
  return (
    <View
      style={{
        backgroundColor: surface.background,
        borderColor: surface.border,
        borderRadius: 16,
        borderWidth: 1,
        boxShadow: surface.shadows,
        margin: 12,
        padding: 12,
      }}
    >
      {mode === "search" ? (
        <TextInput
          accessibilityLabel="Search people"
          autoFocus
          onChangeText={setQuery}
          placeholder="Search people…"
          placeholderTextColor={theme.dividerText}
          value={query}
          style={{
            backgroundColor: input.background,
            borderColor: input.border,
            borderRadius: 12,
            borderWidth: 1,
            boxShadow: input.shadows,
            color: isDark ? "#eeeeee" : "#202020",
            fontFamily: "SofiaProReg",
            fontSize: 14,
            padding: 12,
          }}
        />
      ) : (
        <Text
          style={{
            color: isDark ? "#eeeeee" : "#202020",
            fontFamily: "SofiaProMed",
            fontSize: 14,
          }}
        >
          Online friends
        </Text>
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ maxHeight: 256 }}
      >
        {people.map((person) => (
          <PressableRow
            key={person.id}
            onPress={() => {
              void open(person);
            }}
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 12,
              padding: 12,
            }}
          >
            <UserAvatar
              size={32}
              url={person.avatarUrl}
              userId={person.id}
              username={person.username}
            />
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: isDark ? "#eeeeee" : "#202020",
                  fontFamily: "SofiaProMed",
                  fontSize: 14,
                }}
              >
                {person.displayName || person.username}
              </Text>
              <Text
                style={{
                  color: theme.dividerText,
                  fontFamily: "SofiaProReg",
                  fontSize: 12,
                }}
              >
                @{person.username}
              </Text>
            </View>
          </PressableRow>
        ))}
        {people.length === 0 ? (
          <Text
            style={{
              color: theme.dividerText,
              fontFamily: "SofiaProReg",
              fontSize: 12,
              paddingVertical: 12,
            }}
          >
            {emptyPeopleLabel(error, loading, mode, query)}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function emptyPeopleLabel(
  error: boolean,
  loading: boolean,
  mode: "online" | "search",
  query: string
): string {
  if (error) {
    return "Couldn't load people. Try again.";
  }
  if (loading) {
    return "Loading…";
  }
  if (mode === "online") {
    return "No friends online right now";
  }
  return query.trim() ? "No people found" : "Find someone to message";
}
