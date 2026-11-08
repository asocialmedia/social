import expectedStatements from "../../../web/public/.well-known/assetlinks.json";

type FetchAssociation = (
  url: string,
  init: RequestInit
) => Response | Promise<Response>;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function verifyAppLinksHost(
  host: string,
  baseFetch: FetchAssociation = fetch
): Promise<void> {
  const response = await baseFetch(
    `https://${host}/.well-known/assetlinks.json`,
    {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (
    response.status !== 200 ||
    !response.headers.get("content-type")?.includes("application/json")
  ) {
    throw new Error(
      `${host}: expected a direct 200 application/json association response, got ${response.status}`
    );
  }
  const statements: unknown = await response.json();
  if (!Array.isArray(statements)) {
    throw new TypeError(`${host}: association response is not an array`);
  }
  for (const expected of expectedStatements) {
    const matched = statements.some((statement: unknown) => {
      if (!record(statement) || !record(statement.target)) {
        return false;
      }
      const { target } = statement;
      const fingerprints = target.sha256_cert_fingerprints;
      const relations = statement.relation;
      return (
        target.namespace === expected.target.namespace &&
        target.package_name === expected.target.package_name &&
        Array.isArray(fingerprints) &&
        expected.target.sha256_cert_fingerprints.every((fingerprint) =>
          fingerprints.includes(fingerprint)
        ) &&
        Array.isArray(relations) &&
        expected.relation.every((relation) => relations.includes(relation)) &&
        JSON.stringify(statement.relation_extensions) ===
          JSON.stringify(expected.relation_extensions)
      );
    });
    if (!matched) {
      throw new Error(
        `${host}: deployed app identity or browser-only About rules do not match the release configuration`
      );
    }
  }
}

if (import.meta.main) {
  const results = await Promise.allSettled(
    ["asocialmedia.cc", "www.asocialmedia.cc"].map((host) =>
      verifyAppLinksHost(host)
    )
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(result.reason);
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) {
    console.log(
      "Both hosts serve direct, valid Android app associations and About exclusions."
    );
  }
}
