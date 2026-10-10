import type { ResumeState } from "./app-resume";

// Launch waits for local state only. A broken storage bridge must not hold
// the splash indefinitely, and a late read must never navigate over the user.
export async function prepareStartup(
  tasks: readonly (() => Promise<unknown>)[],
  timeoutMs = 2500
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(tasks.map((task) => Promise.resolve().then(task))),
      // oxlint-disable-next-line promise/avoid-new -- native IO needs a cancellable launch deadline
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function startupDestination(
  currentPath: string,
  resume: ResumeState | null
): string {
  return currentPath === "/" ? (resume?.pathname ?? currentPath) : currentPath;
}

export function resumeHref(resume: ResumeState): string {
  const query = Object.entries(resume.params ?? {})
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join("&");
  return query ? `${resume.pathname}?${query}` : resume.pathname;
}
