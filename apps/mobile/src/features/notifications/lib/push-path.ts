import { nativeNetworkPath } from "@/features/network/lib/network-paths";

// A notification always names something the viewer was told about, so an
// unmapped target opens the notifications list where that item still lives.
export function pathToNativeRoute(path: string): string {
  return nativeNetworkPath(path) ?? "/notifications";
}
