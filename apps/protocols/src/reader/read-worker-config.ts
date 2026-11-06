export interface ReadWorkerNode {
  id: string;
  url: string;
  token: string;
}

export function readWorkerNodes(raw: string | undefined): ReadWorkerNode[] {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "[]");
  } catch {
    throw new Error("PROTOCOLS_READ_WORKERS must be valid JSON");
  }
  if (!Array.isArray(value) || value.length > 8) {
    throw new Error(
      "PROTOCOLS_READ_WORKERS must be an array of at most eight nodes"
    );
  }
  const ids = new Set<string>();
  const urls = new Set<string>();
  return value.map((node: unknown) => {
    if (
      !node ||
      typeof node !== "object" ||
      !("id" in node) ||
      !("url" in node) ||
      !("token" in node) ||
      typeof node.id !== "string" ||
      node.id === "local" ||
      !/^[a-zA-Z0-9_-]{1,48}$/.test(node.id) ||
      typeof node.url !== "string" ||
      typeof node.token !== "string" ||
      !/^[a-zA-Z0-9_-]{32,256}$/.test(node.token)
    ) {
      throw new Error(
        "Each read worker requires a unique id, HTTPS origin and dedicated token"
      );
    }
    const url = new URL(node.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      ids.has(node.id) ||
      urls.has(url.origin)
    ) {
      throw new Error("Read workers require distinct HTTPS origins and ids");
    }
    ids.add(node.id);
    urls.add(url.origin);
    return { id: node.id, token: node.token, url: url.origin };
  });
}
