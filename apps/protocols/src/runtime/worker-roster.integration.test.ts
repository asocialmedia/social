import { expect, test } from "bun:test";

import { feedAuthorityKeys } from "@asm/protocols/discovery";
import Redis from "ioredis";

const readerUrl = process.env.TEST_WORKER_ROSTER_READER_URL;
const operatorUrl = process.env.TEST_WORKER_ROSTER_OPERATOR_URL;

test.skipIf(!readerUrl || !operatorUrl)(
  "dedicated Redis allows only the operator to change the worker roster",
  async () => {
    const readerEndpoint = new URL(readerUrl ?? "");
    const operatorEndpoint = new URL(operatorUrl ?? "");
    expect(readerEndpoint.hostname).toBe("127.0.0.1");
    expect(operatorEndpoint.host).toBe(readerEndpoint.host);
    const options = {
      commandTimeout: 1000,
      connectTimeout: 1500,
      disableClientInfo: true,
      enableOfflineQueue: false,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy: () => null,
    };
    const reader = new Redis(readerUrl ?? "", options);
    const operator = new Redis(operatorUrl ?? "", options);
    readerEndpoint.username = "";
    readerEndpoint.password = "";
    const anonymous = new Redis(readerEndpoint.toString(), {
      ...options,
      protocol: 2,
    });
    const { workers } = feedAuthorityKeys;
    try {
      await Promise.all([
        reader.connect(),
        operator.connect(),
        anonymous.connect(),
      ]);
      const roster = '["eu-east"]';
      expect(await operator.set(workers, roster)).toBe("OK");
      expect(await reader.get(workers)).toBe(roster);
      await expect(reader.set(workers, "[]")).rejects.toThrow("NOPERM");
      await expect(reader.del(workers)).rejects.toThrow("NOPERM");
      await expect(reader.get("unrelated")).rejects.toThrow("NOPERM");
      await expect(operator.set("unrelated", "[]")).rejects.toThrow("NOPERM");
      await expect(operator.config("GET", "aclfile")).rejects.toThrow("NOPERM");
      await expect(anonymous.get(workers)).rejects.toThrow("NOAUTH");
      expect(await operator.del(workers)).toBe(1);
      expect(await reader.get(workers)).toBeNull();
    } finally {
      reader.disconnect();
      operator.disconnect();
      anonymous.disconnect();
    }
  }
);
