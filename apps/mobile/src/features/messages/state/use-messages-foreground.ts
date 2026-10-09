import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

// Native stacks retain covered screens. Their sockets and polls must stop on
// blur as well as background, then reconcile when the screen becomes active.
export function useMessagesForeground(): boolean {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setActive(state === "active");
    });
    return () => subscription.remove();
  }, []);
  return focused && active;
}
