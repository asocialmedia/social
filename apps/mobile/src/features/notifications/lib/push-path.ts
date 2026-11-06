import { nativeNetworkPath } from "@/features/network/lib/network-paths";

export function pathToNativeRoute(path: string): string {
  const pathname = path.split(/[?#]/u)[0] ?? "";
  const communityChat =
    /^\/a\/(?<slug>[a-zA-Z0-9_-]+)\/chat(?:\/(?<channel>[a-zA-Z0-9_-]+)(?:\/threads\/(?<thread>[a-zA-Z0-9_-]+))?)?\/?$/u.exec(
      pathname
    )?.groups;
  if (communityChat?.slug) {
    const channel = communityChat.channel ? `/${communityChat.channel}` : "";
    const thread = communityChat.thread
      ? `/threads/${communityChat.thread}`
      : "";
    const message = new URLSearchParams(path.split("?")[1]?.split("#")[0]).get(
      "message"
    );
    const query =
      message && /^[a-zA-Z0-9_-]+$/u.test(message) ? `?message=${message}` : "";
    return `/a/${communityChat.slug}/chat${channel}${thread}${query}`;
  }
  return nativeNetworkPath(path) ?? "/notifications";
}
