import { Redirect } from "expo-router";

export default function CommunityCreateRoute() {
  return (
    <Redirect href={{ params: { create: "1" }, pathname: "/communities" }} />
  );
}
