interface AuditOutcome {
  formFactor?: unknown;
  route?: unknown;
  state?: unknown;
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
