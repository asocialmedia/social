import path from "node:path";

export function appPageRoute(file: string) {
  const normalized = file.replaceAll("\\", "/");
  if (!/(?:^|\/)page\.tsx?$/.test(normalized)) {
    return null;
  }
  const route = normalized
    .replace(/^.*?src\/app\//, "")
    .replace(/(?:^|\/)page\.tsx?$/, "")
    .split("/")
    .filter(
      (segment) =>
        segment && !segment.startsWith("(") && !segment.startsWith("@")
    )
    .join("/");
  return `/${route}`;
}

export async function siteRouteInventory(
  root: string,
  fixtures: Record<string, string> = {}
) {
  const glob = new Bun.Glob("**/page.{ts,tsx}");
  const entries: {
    file: string;
    route: string;
    path: string | null;
    state: string;
  }[] = [];
  for await (const file of glob.scan({
    cwd: path.join(root, "apps/web/src/app"),
  })) {
    const source = `apps/web/src/app/${file.replaceAll("\\", "/")}`;
    const route = appPageRoute(source);
    if (!route) {
      continue;
    }
    const sample = fixtures[route] ?? (!route.includes("[") ? route : null);
    entries.push({
      file: source,
      route,
      path: sample,
      state: sample ? "ready" : "needs-fixture",
    });
  }
  return entries.toSorted((left, right) =>
    left.route.localeCompare(right.route)
  );
}
