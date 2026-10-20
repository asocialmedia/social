import Svg, { Path } from "react-native-svg";

export function BlueskyIcon() {
  return (
    <Svg
      accessibilityLabel="Bluesky"
      height={16}
      viewBox="0 0 24 24"
      width={16}
    >
      <Path
        d="M4 3c3 1 6 5 8 9 2-4 5-8 8-9 4-2 4 2 3 7-.6 4-3 5-7 4 6 2 6 5 2 7-3 2-5-1-6-4-1 3-3 6-6 4-4-2-4-5 2-7-4 1-6.4 0-7-4C0 5 0 1 4 3Z"
        fill="#0085ff"
      />
    </Svg>
  );
}
