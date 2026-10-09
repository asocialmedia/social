// The Google and Reddit marks for the sign-in-methods cards, matching the
// brand SVGs web serves from `/socials/{provider}.svg`. The marks are drawn
// bare on the card surface - no tile or chip behind them - exactly as web
// places them.
import { GoogleIcon } from "@/components/icons/google-icon";
import { RedditIcon } from "@/components/icons/reddit-icon";

export function SettingsBrandLogo({
  provider,
  size = 28,
}: {
  provider: "google" | "reddit";
  size?: number;
}) {
  return provider === "google" ? (
    <GoogleIcon size={size} />
  ) : (
    <RedditIcon size={size} />
  );
}
