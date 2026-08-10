import { describe, expect, test } from "bun:test";
import { createRedisConnectionOptions } from "./redis-options";

function baseConfig() {
  return {
    connectTimeout: 5000,
    maxRetriesPerRequest: 2,
  };
}

describe("redis connection option parsing", () => {
  test("parses redis url with password and db", () => {
    const options = createRedisConnectionOptions(
      "redis://:asmredis@localhost:6379/0",
      baseConfig()
    );

    expect(options.host).toBe("localhost");
    expect(options.port).toBe(6379);
    expect(options.password).toBe("asmredis");
    expect(options.db).toBe(0);
    expect(options.tls).toBeUndefined();
  });

  test("parses redis url with username and password", () => {
    const options = createRedisConnectionOptions(
      "redis://default:asmredis@127.0.0.1:6380/2",
      baseConfig()
    );

    expect(options.host).toBe("127.0.0.1");
    expect(options.port).toBe(6380);
    expect(options.username).toBe("default");
    expect(options.password).toBe("asmredis");
    expect(options.db).toBe(2);
  });

  test("enables tls for rediss protocol", () => {
    const options = createRedisConnectionOptions(
      "rediss://redis.example.com:6380/0",
      baseConfig()
    );

    expect(options.host).toBe("redis.example.com");
    expect(options.port).toBe(6380);
    expect(options.tls).toEqual({});
  });

  test("throws for unsupported protocols", () => {
    expect(() =>
      createRedisConnectionOptions("http://localhost:6379", baseConfig())
    ).toThrow("Unsupported Redis protocol: http:");
  });
});
