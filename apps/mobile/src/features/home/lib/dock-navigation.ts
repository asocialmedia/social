// Selection follows the visible route even while a restored session hydrates.
export function dockTabState(
  pathname: string,
  destination: string,
  requiresAuth: boolean,
  isLoggedIn: boolean
) {
  const selected =
    destination === "/"
      ? pathname === "/"
      : pathname === destination || pathname.startsWith(`${destination}/`);
  return { requiresLogin: requiresAuth && !isLoggedIn, selected };
}
