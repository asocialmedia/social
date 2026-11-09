import { authDeepLinkPath } from "@/features/auth/lib/auth-deep-link";
import {
  UNMAPPED_LINK_FALLBACK,
  nativeNetworkPath,
} from "@/features/network/lib/network-paths";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  try {
    return (
      authDeepLinkPath(path) ??
      nativeNetworkPath(path) ??
      UNMAPPED_LINK_FALLBACK
    );
  } catch {
    return UNMAPPED_LINK_FALLBACK;
  }
}
