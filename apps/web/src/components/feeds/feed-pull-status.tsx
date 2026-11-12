export function FeedPullStatus({
  state,
}: {
  state: "idle" | "pulling" | "ready" | "refreshing" | "error";
}) {
  if (state === "idle") {
    return null;
  }
  const labels = {
    error: "Couldn't refresh. Pull to try again.",
    pulling: "Pull to refresh",
    ready: "Release to refresh",
    refreshing: "Refreshing feed…",
  };
  return (
    <output className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2">
      <div className="panel-3d rounded-full! px-4 py-2 text-xs font-medium">
        {labels[state]}
      </div>
    </output>
  );
}
