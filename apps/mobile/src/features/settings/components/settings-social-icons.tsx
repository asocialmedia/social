// Brand glyphs for the profile tab's social fields, from Font Awesome 6
// (via @expo/vector-icons) so they match web's `react-icons/fa6` set exactly:
// GitHub, LinkedIn, X/Twitter and Reddit. These are brand marks, so they are
// drawn bare - no tile or chip behind them - which is how web places them in
// the field's leading slot.
import { FontAwesome6 } from "@expo/vector-icons";

type IconName = "github" | "linkedin" | "reddit" | "x-twitter";

export function SocialBrandIcon({
  color,
  name,
  size = 16,
}: {
  color?: string;
  name: IconName;
  size?: number;
}) {
  return <FontAwesome6 color={color} name={name} size={size} />;
}
