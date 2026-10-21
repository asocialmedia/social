import { Redirect, useLocalSearchParams } from "expo-router";

export default function BlueskyLink() {
  const { uri, media } = useLocalSearchParams<{
    uri?: string;
    media?: string;
  }>();
  if (!uri?.startsWith("at://")) {
    return <Redirect href="/" />;
  }
  return media === undefined ? (
    <Redirect href={{ params: { uri }, pathname: "/external-post" }} />
  ) : (
    <Redirect
      href={{ params: { index: media, uri }, pathname: "/external-media" }}
    />
  );
}
