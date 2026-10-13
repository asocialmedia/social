import { useRouter } from "expo-router";
import { ChevronRight, FileText, Scale, Shield } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { useAppTheme } from "@/theme";

import {
  SettingsCard,
  SettingsCardHeading,
  SettingsSubcard,
} from "./settings-ui";

const DOCUMENTS = [
  {
    description: "The rules for using asocialmedia",
    document: "terms",
    icon: FileText,
    title: "Terms & Conditions",
  },
  {
    description: "How your data is collected and protected",
    document: "privacy",
    icon: Shield,
    title: "Privacy Policy",
  },
] as const;

export function LegalSettingsLinks() {
  const router = useRouter();
  const { theme } = useAppTheme();
  return (
    <SettingsCard>
      <SettingsCardHeading
        icon={Scale}
        title="Legal"
        description="The Terms and Privacy Policy you accepted when you signed up."
      />
      {DOCUMENTS.map(({ document, title, description, icon: Icon }) => (
        <Pressable
          key={document}
          accessibilityRole="button"
          accessibilityLabel={title}
          onPress={() =>
            router.push({ params: { document }, pathname: "/legal/[document]" })
          }
        >
          <SettingsSubcard
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 12,
              padding: 14,
            }}
          >
            <Icon color={theme.auxLink} size={22} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text
                style={{
                  color: theme.inputText,
                  fontFamily: "SofiaProMed",
                  fontSize: 14,
                }}
              >
                {title}
              </Text>
              <Text
                style={{
                  color: theme.dividerText,
                  fontFamily: "SofiaProReg",
                  fontSize: 12,
                }}
              >
                {description}
              </Text>
            </View>
            <ChevronRight color={theme.dividerText} size={16} />
          </SettingsSubcard>
        </Pressable>
      ))}
    </SettingsCard>
  );
}
