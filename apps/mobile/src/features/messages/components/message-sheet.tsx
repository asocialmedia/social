import { BottomSheet, Host, RNHostView } from "@expo/ui";
import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";

import { useAppTheme } from "@/theme";

import { MessagesIconButton } from "./messages-primitives";

export function MessageSheet({
  children,
  title,
  open,
  onClose,
  busy = false,
  overlay,
}: {
  children: ReactNode;
  title: string;
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  overlay?: ReactNode;
}) {
  const { isDark, theme } = useAppTheme();
  const { height, width } = useWindowDimensions();
  return (
    <Host colorScheme={isDark ? "dark" : "light"}>
      <BottomSheet
        isPresented={open}
        onDismiss={onClose}
        containerColor={theme.cardBg}
        contentPadding={0}
        shouldDismissOnBackPress={!busy}
        shouldDismissOnClickOutside={!busy}
        snapPoints={["full"]}
      >
        <RNHostView style={{ height: Math.max(height - 120, 240), width }}>
          <View style={{ flex: 1 }}>
            <View
              style={{
                alignItems: "center",
                borderBottomColor: theme.dividerLine,
                borderBottomWidth: 1,
                flexDirection: "row",
                height: 56,
                justifyContent: "space-between",
                paddingHorizontal: 20,
              }}
            >
              <Text
                style={{
                  color: theme.inputText,
                  fontFamily: "SofiaProBold",
                  fontSize: 18,
                }}
              >
                {title}
              </Text>
              <MessagesIconButton
                icon={X}
                label={`Close ${title}`}
                onPress={onClose}
                disabled={busy}
                size={32}
              />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: 16, padding: 20 }}
            >
              {children}
            </ScrollView>
            {overlay}
          </View>
        </RNHostView>
      </BottomSheet>
    </Host>
  );
}
