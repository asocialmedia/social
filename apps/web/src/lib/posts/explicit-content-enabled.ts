import { readNetworkPreferences } from "@asm/db";

// A known post id, a search hit or a media URL must not bypass the feed policy.
// Guests have no identity and can never opt in, so they always read false.
export async function explicitContentEnabled(userId: string): Promise<boolean> {
  if (!userId) {
    return false;
  }
  const settings = await readNetworkPreferences(userId);
  return Boolean(settings?.preferences.showExplicitContent);
}
