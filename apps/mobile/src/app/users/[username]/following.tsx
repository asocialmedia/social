import { Redirect, useLocalSearchParams } from "expo-router";

export default function FollowingRoute() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return (
    <Redirect
      href={{
        params: { tab: "following", username },
        pathname: "/users/[username]/followers",
      }}
    />
  );
}
