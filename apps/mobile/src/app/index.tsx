import { useIsFocused } from "expo-router";
import { useState } from "react";

import HomeScreen from "@/features/home/components/home-screen";
import { shouldMountHome } from "@/lib/startup";
import {
  useStartupPresented,
  useStartupResumePath,
} from "@/lib/startup-context";

export default function IndexScreen() {
  const focused = useIsFocused();
  const presented = useStartupPresented();
  const resumePath = useStartupResumePath();
  const [visited, setVisited] = useState(false);
  const mount = shouldMountHome(visited, focused, presented, resumePath);
  if (mount && !visited) {
    setVisited(true);
  }
  // Retain drafts once Home has been visited, without booting its editor and
  // neighbouring feeds underneath an unrelated restored screen.
  return mount ? <HomeScreen /> : null;
}
