import { nativeNetworkPath } from "@/features/network/lib/network-paths";

export function pathToNativeRoute(path: string): string {
  return nativeNetworkPath(path) ?? "/notifications";
}
