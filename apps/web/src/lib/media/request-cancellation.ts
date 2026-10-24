export function mediaRequestWasCancelled(
  error: unknown,
  signal: AbortSignal
): boolean {
  return (
    signal.aborted || (error instanceof Error && error.name === "AbortError")
  );
}
