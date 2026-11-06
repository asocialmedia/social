// Client-safe import: the accent palette is presentation data, so it comes from
// the dependency-free @asm/db/communities entry rather than the server barrel.
import { getCommunityAccent } from "@asm/db/communities";

// Resolves a community accent key to a theme-aware CSS custom property pair.
// The returned style sets --community-accent (light) and
// --community-accent-dark. The community-accent-scope component class resolves
// the pair through --community-accent-resolved using the app theme class.
export function communityAccentStyle(accentKey: string): React.CSSProperties {
  const accent = getCommunityAccent(accentKey);
  return {
    "--community-accent": accent.light,
    "--community-accent-dark": accent.dark,
  } as React.CSSProperties;
}

export function communityAccentColor(accentKey: string, dark: boolean): string {
  const accent = getCommunityAccent(accentKey);
  return dark ? accent.dark : accent.light;
}
