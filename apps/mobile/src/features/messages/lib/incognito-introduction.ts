import * as SecureStore from "expo-secure-store";
import { Alert } from "react-native";

const acknowledgedAccounts = new Set<string>();
const pendingAcknowledgements = new Map<string, Promise<void>>();

export async function acknowledgeNativeIncognitoIntroduction(
  userId: string
): Promise<void> {
  if (acknowledgedAccounts.has(userId)) {
    return;
  }
  const pending = pendingAcknowledgements.get(userId);
  if (pending) {
    return pending;
  }
  const task = (async () => {
    const key = `incognito-introduction.${encodeURIComponent(userId).replaceAll("%", "_")}`;
    try {
      if ((await SecureStore.getItemAsync(key)) === "seen") {
        acknowledgedAccounts.add(userId);
        return;
      }
    } catch {
      // An unavailable device store falls back to this app session's memory.
    }
    // oxlint-disable-next-line promise/avoid-new -- Native Alert reports acknowledgement through a callback.
    await new Promise<void>((resolve) => {
      Alert.alert(
        "Meet incognito chat",
        "A separate space for temporary conversations. Each message disappears 24 hours after you send it. Either of you can end incognito to delete all its messages immediately. A short note stays in your regular chat to show incognito was used.",
        [
          {
            onPress: () => {
              acknowledgedAccounts.add(userId);
              void SecureStore.setItemAsync(key, "seen").catch(() => {
                // The acknowledgement remains in memory when device storage fails.
              });
              resolve();
            },
            text: "Okay, I get it",
          },
        ],
        { cancelable: false }
      );
    });
  })();
  pendingAcknowledgements.set(userId, task);
  try {
    await task;
  } finally {
    pendingAcknowledgements.delete(userId);
  }
}
