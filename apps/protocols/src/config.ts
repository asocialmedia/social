import { jetstreamEndpoints } from "@asm/protocols/jetstream";
import type { JetstreamEndpoint } from "@asm/protocols/jetstream";

export interface ProtocolsConfig {
  asmUrl?: string;
  hostname: string;
  port: number;
  token?: string;
  redisUrl?: string;
  jetstreamEnabled: boolean;
  dids: string[];
  endpoint: JetstreamEndpoint;
}

export function readConfig(
  env: Record<string, string | undefined>
): ProtocolsConfig {
  const port = Number(env.PROTOCOLS_PORT ?? "3012");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PROTOCOLS_PORT must be a valid port");
  }
  const token = env.PROTOCOLS_INTERNAL_TOKEN;
  if (
    env.NODE_ENV === "production" &&
    token === "asm_protocols_development_only_replace_in_production"
  ) {
    throw new Error("Production requires a unique PROTOCOLS_INTERNAL_TOKEN");
  }
  if (
    token !== undefined &&
    (token.length < 32 || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token))
  ) {
    throw new Error(
      "PROTOCOLS_INTERNAL_TOKEN must contain 32–256 URL-safe characters"
    );
  }
  const enabled = env.PROTOCOLS_JETSTREAM_ENABLED ?? "false";
  if (enabled !== "true" && enabled !== "false") {
    throw new Error("PROTOCOLS_JETSTREAM_ENABLED must be true or false");
  }
  const dids = [
    ...new Set(
      (env.PROTOCOLS_BLUESKY_DIDS ?? "")
        .split(",")
        .map((did) => did.trim())
        .filter(Boolean)
    ),
  ].toSorted();
  if (
    dids.length > 1000 ||
    dids.some((did) => !/^did:(?:plc|web):[A-Za-z0-9._:%-]{1,2000}$/.test(did))
  ) {
    throw new Error(
      "PROTOCOLS_BLUESKY_DIDS must be a bounded list of valid DIDs"
    );
  }
  const endpoint = jetstreamEndpoints.find(
    (candidate) =>
      candidate === (env.PROTOCOLS_JETSTREAM_ENDPOINT ?? jetstreamEndpoints[0])
  );
  if (!endpoint) {
    throw new Error(
      "PROTOCOLS_JETSTREAM_ENDPOINT must be a supported public endpoint"
    );
  }
  const redisUrl = env.REDIS_URL;
  if (env.NODE_ENV === "production" && token && !redisUrl) {
    throw new Error(
      "Production discovery requires REDIS_URL for shared continuations"
    );
  }
  const asmUrl =
    env.PROTOCOLS_ASM_URL ??
    env.NEXT_PUBLIC_URL ??
    (env.NODE_ENV === "development" ? "http://localhost:3000" : undefined);
  if (asmUrl) {
    const parsed = new URL(asmUrl);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("PROTOCOLS_ASM_URL must be an HTTP origin");
    }
  }
  if (
    enabled === "true" &&
    (!redisUrl || (asmUrl && !token) || (!asmUrl && !dids.length))
  ) {
    throw new Error(
      "Jetstream requires REDIS_URL and either ASM registry credentials or seed DIDs"
    );
  }
  if (redisUrl) {
    let parsed: URL;
    try {
      parsed = new URL(redisUrl);
    } catch {
      throw new Error("REDIS_URL must be a Redis URL");
    }
    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
      throw new Error("REDIS_URL must be a Redis URL");
    }
  }
  return {
    asmUrl,
    dids,
    endpoint,
    hostname: env.PROTOCOLS_HOST ?? "0.0.0.0",
    jetstreamEnabled: enabled === "true",
    port,
    redisUrl,
    token,
  };
}
