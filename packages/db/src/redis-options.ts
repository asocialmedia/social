import type { RedisOptions } from "ioredis";

const DEFAULT_REDIS_PORT = 6379;
const REDIS_PATH_PREFIX_REGEX = /^\//;

export function createRedisConnectionOptions(
  redisUrl: string,
  baseConfig: RedisOptions
): RedisOptions {
  const parsedUrl = new URL(redisUrl);

  if (!(parsedUrl.protocol === "redis:" || parsedUrl.protocol === "rediss:")) {
    throw new Error(`Unsupported Redis protocol: ${parsedUrl.protocol}`);
  }

  const parsedDb = parsedUrl.pathname.replace(REDIS_PATH_PREFIX_REGEX, "");
  const db = parsedDb.length > 0 ? Math.trunc(Number(parsedDb)) : undefined;
  const port = parsedUrl.port
    ? Math.trunc(Number(parsedUrl.port))
    : DEFAULT_REDIS_PORT;

  const options: RedisOptions = {
    ...baseConfig,
    host: parsedUrl.hostname,
    port,
  };

  if (parsedUrl.username.length > 0) {
    options.username = parsedUrl.username;
  }

  if (parsedUrl.password.length > 0) {
    options.password = parsedUrl.password;
  }

  if (typeof db === "number" && Number.isInteger(db) && db >= 0) {
    options.db = db;
  }

  if (parsedUrl.protocol === "rediss:") {
    options.tls = {};
  }

  return options;
}
