import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useState } from "react";
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
import { useSessionContext } from "@/features/auth/state/session";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

export default function CommunityCreateRoute() {
  const router = useRouter();
  const { isPending, user } = useSessionContext();
  const { theme } = useAppTheme();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [topics, setTopics] = useState("art");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mobileHeaderUser = user
    ? { ...user, username: user.username ?? "unknown" }
    : null;

  const submit = async () => {
    if (!user) {
      router.push("/(auth)/login");
      return;
    }
    const slug = slugify(name);
    if (!slug || !description.trim()) {
      setError("Add a name and description.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const cookie = await authClient.getCookie();
      const response = await fetch(`${getApiBaseUrl()}/api/communities`, {
        body: JSON.stringify({
          accentColor: "orange",
          description: description.trim(),
          mature: false,
          name: name.trim(),
          slug,
          topics: topics
            .split(",")
            .map((topic) => topic.trim())
            .filter(Boolean),
          type: "PUBLIC",
        }),
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        slug?: string;
      } | null;
      if (!response.ok || !payload?.slug) {
        setError(payload?.error ?? "Couldn't create community");
        setPending(false);
        return;
      }
      router.replace({ params: { slug: payload.slug }, pathname: "/a/[slug]" });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Couldn't create community"
      );
      setPending(false);
    }
  };

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
            onPress={() => router.back()}
            style={styles.back}
          >
            <ArrowLeft color={theme.inputText} size={21} />
          </Pressable>
          <Text style={[styles.title, { color: theme.inputText }]}>
            Create community
          </Text>
        </View>
        <View style={styles.form}>
          <Text style={[styles.label, { color: theme.inputText }]}>Name</Text>
          <TextInput
            autoCapitalize="words"
            onChangeText={setName}
            placeholder="Community name"
            placeholderTextColor={theme.inputPlaceholder}
            style={[
              styles.input,
              { borderColor: theme.cardBorder, color: theme.inputText },
            ]}
            value={name}
          />
          <Text style={[styles.label, { color: theme.inputText }]}>
            Description
          </Text>
          <TextInput
            multiline
            onChangeText={setDescription}
            placeholder="What is this community for?"
            placeholderTextColor={theme.inputPlaceholder}
            style={[
              styles.input,
              styles.descriptionInput,
              { borderColor: theme.cardBorder, color: theme.inputText },
            ]}
            value={description}
          />
          <Text style={[styles.label, { color: theme.inputText }]}>Topics</Text>
          <TextInput
            autoCapitalize="none"
            onChangeText={setTopics}
            placeholder="art, music"
            placeholderTextColor={theme.inputPlaceholder}
            style={[
              styles.input,
              { borderColor: theme.cardBorder, color: theme.inputText },
            ]}
            value={topics}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={pending || isPending}
            onPress={submit}
            style={({ pressed }) => [
              styles.submit,
              { opacity: pressed ? 0.88 : 1 },
            ]}
          >
            {pending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.submitText}>Create community</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  back: { padding: 8 },
  content: { paddingBottom: 40 },
  descriptionInput: { minHeight: 104, textAlignVertical: "top" },
  error: { color: "#ffb4a6", fontFamily: "SofiaProReg", fontSize: 13 },
  form: { gap: 8, padding: 16 },
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
  root: { flex: 1 },
  submit: {
    alignItems: "center",
    backgroundColor: "#f97316",
    borderRadius: 10,
    justifyContent: "center",
    marginTop: 16,
    minHeight: 44,
  },
  submitText: { color: "#ffffff", fontFamily: "SofiaProBold", fontSize: 14 },
  title: { fontFamily: "SofiaProBold", fontSize: 18 },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 8,
  },
});
