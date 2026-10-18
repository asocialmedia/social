import { communityChatFeatureEnabled } from "@asm/messages";

export const communityChatUiEnabled = communityChatFeatureEnabled(
  process.env.EXPO_PUBLIC_COMMUNITY_CHAT_ENABLED,
  process.env.NODE_ENV
);
