import { Redirect, useLocalSearchParams } from "expo-router";

export default function BlueskyProfileLink() {
  const { actor } = useLocalSearchParams<{ actor?: string }>();
  return (
    <Redirect
      href={actor ? { params: { actor }, pathname: "/external-profile" } : "/"}
    />
  );
}
