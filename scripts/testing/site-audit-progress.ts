interface AuditOutcome {
  formFactor?: unknown;
  route?: unknown;
  state?: unknown;
}

export async function withAuditDeadline<T>(
  operation: Promise<T>,
  timeoutMs = 180_000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // oxlint-disable-next-line promise/avoid-new -- Adapt the callback-based timer to a deadline promise.
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Lighthouse exceeded its ${timeoutMs} ms deadline`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function routeAuditComplete(
  results: readonly AuditOutcome[],
  route: string
): boolean {
  const completed = results.filter(
    (result) =>
      result.route === route &&
      ["audited", "redirect", "http-checked"].includes(String(result.state))
  );
  return (
    completed.some((result) => !result.formFactor) ||
    ["mobile", "desktop"].every((device) =>
      completed.some((result) => result.formFactor === device)
    )
  );
}
