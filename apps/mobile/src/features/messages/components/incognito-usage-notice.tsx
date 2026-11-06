import { incognitoNotice, incognitoUsageDuration } from "@asm/messages";
import type { IncognitoSession } from "@asm/messages";
import { Shield } from "lucide-react-native";
import { Text, View } from "react-native";

import { useAppTheme } from "@/theme";

export function NativeIncognitoUsageNotice({
  session,
}: {
  session: IncognitoSession;
}) {
  const { theme } = useAppTheme();
  const duration = incognitoUsageDuration(session);
  const timing = `${new Date(session.startedAt).toLocaleString()}${session.endedAt ? ` – ${new Date(session.endedAt).toLocaleString()}` : ""}`;
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${incognitoNotice(session)}. ${timing}${duration ? ` · Duration: ${duration}` : ""}`}
      style={{
        alignItems: "center",
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 5,
        justifyContent: "center",
        marginHorizontal: 20,
        marginVertical: 6,
      }}
    >
      <Shield size={10} color={theme.dividerText} />
      <Text
        style={{ color: theme.dividerText, fontSize: 11, textAlign: "center" }}
      >
        {session.startedByName}{" "}
        {session.endedAt ? "used incognito" : "started incognito"}
      </Text>
      <Text style={{ color: theme.dividerText, fontSize: 10, opacity: 0.85 }}>
        {new Date(session.startedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Text>
      {duration ? (
        <Text style={{ color: theme.dividerText, fontSize: 10, opacity: 0.85 }}>
          · {duration}
        </Text>
      ) : null}
    </View>
  );
}
