"use client";

// Writes one search param into the current history entry. `replace` keeps a tab
// switch out of the back stack (switching sections inside one page is not a
// navigation), while `push` is for opening a real section page from a hub: the
// browser's Back button must be able to return to that hub.
export function writeSettingsSearchParam({
  key,
  mode = "replace",
  value,
}: {
  key: string;
  mode?: "push" | "replace";
  value: string | null;
}) {
  if (typeof window === "undefined") {
    return;
  }
  const next = new URLSearchParams(window.location.search);
  if (value === null) {
    next.delete(key);
  } else {
    next.set(key, value);
  }
  const query = next.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
  if (mode === "push") {
    window.history.pushState(window.history.state, "", url);
    return;
  }
  window.history.replaceState(window.history.state, "", url);
}
