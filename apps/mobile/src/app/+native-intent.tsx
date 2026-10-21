import { nativeNetworkPath } from "@/features/network/lib/network-paths";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  try {
    return nativeNetworkPath(path) ?? "/notifications";
  } catch {
    return "/notifications";
  }
}
