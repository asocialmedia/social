import { requestFeedTop } from "./feed-top-request";

export function reselectFeedNavigation(
  href: string,
  pathname: string,
  event: { preventDefault: () => void },
  searchParams: Pick<URLSearchParams, "has"> = new URLSearchParams()
): void {
  if (href !== pathname || (href !== "/" && href !== "/gusts")) {
    return;
  }
  if (href === "/gusts" && searchParams.has("id")) {
    return;
  }
  event.preventDefault();
  requestFeedTop(href === "/" ? "home" : "gusts");
}
