import { requestFeedTop } from "./feed-top-request";

export function reselectFeedNavigation(
  href: string,
  pathname: string,
  event: { preventDefault: () => void }
): void {
  if (href !== pathname || (href !== "/" && href !== "/gusts")) {
    return;
  }
  event.preventDefault();
  requestFeedTop(href === "/" ? "home" : "gusts");
}
