export function isCommunityChatPath(pathname: string): boolean {
  return /^\/a\/[^/]+\/chat(?:\/[^/]+(?:\/threads\/[^/]+)?)?\/?$/u.test(
    pathname
  );
}
