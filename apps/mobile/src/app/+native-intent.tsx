import { authDeepLinkPath } from "@/features/auth/lib/auth-deep-link";
import { nativeNetworkPath } from "@/features/network/lib/network-paths";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  try {
    return (
      authDeepLinkPath(path) ?? nativeNetworkPath(path) ?? "/notifications"
    );
  } catch {
    return "/notifications";
  }
}
