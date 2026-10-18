import { communityChatFeatureEnabled } from "@asm/messages";

export const communityChatUiEnabled = communityChatFeatureEnabled(
  process.env.NEXT_PUBLIC_COMMUNITY_CHAT_ENABLED,
  process.env.NODE_ENV
);
