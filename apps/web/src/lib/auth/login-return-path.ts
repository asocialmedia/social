export function getLoginReturnPath(search: string): string {
  const next = new URLSearchParams(search).get("next");
  if (!next?.startsWith("/") || next.startsWith("//")) {
    return "/";
  }
  try {
    const destination = new URL(next, "https://asocialmedia.invalid");
    if (destination.origin !== "https://asocialmedia.invalid") {
      return "/";
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}
