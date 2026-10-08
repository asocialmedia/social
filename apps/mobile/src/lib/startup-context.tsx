import { createContext, useContext } from "react";

// Initial route restoration is presented under the native splash, with no
// navigation animation. Normal transitions resume after the handoff.
export const StartupPresentedContext = createContext(false);
export function useStartupPresented(): boolean {
  return useContext(StartupPresentedContext);
}
