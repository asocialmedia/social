import { Image } from "expo-image";
import { View } from "react-native";

import footer from "@/assets/images/settings/footer.png";
import footer1 from "@/assets/images/settings/footer1.png";
import footer2 from "@/assets/images/settings/footer2.png";
import footer3 from "@/assets/images/settings/footer3.png";

import type { SettingsTab } from "../lib/settings-tabs";

const ART = {
  account: { ratio: 2172 / 724, source: footer1 },
  network: { ratio: 2172 / 724, source: footer1 },
  personalization: { ratio: 2164 / 398, source: footer },
  privacy: { ratio: 2172 / 724, source: footer2 },
  profile: { ratio: 2164 / 398, source: footer },
  security: { ratio: 2172 / 724, source: footer3 },
} satisfies Record<SettingsTab, { source: number; ratio: number }>;

export function SettingsFooterArt({ tab }: { tab: SettingsTab }) {
  const art = ART[tab];
  return (
    <View
      accessible={false}
      style={{ marginHorizontal: -16, marginTop: "auto" }}
    >
      <Image
        accessible={false}
        source={art.source}
        contentFit="contain"
        style={{ aspectRatio: art.ratio, width: "100%" }}
      />
    </View>
  );
}
