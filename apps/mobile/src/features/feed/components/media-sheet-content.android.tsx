import { RNHostView } from "@expo/ui/jetpack-compose";
import type { ReactElement } from "react";

export function MediaSheetContent({ children }: { children: ReactElement }) {
  return <RNHostView matchContents>{children}</RNHostView>;
}
