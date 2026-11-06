import { expect, test } from "bun:test";

import {
  parseWindowsPortOwners,
  findWindowsListeningPids,
  windowsListenerProbeHost,
} from "./platform-listeners";

test("Windows cleanup distinguishes listeners and unknown CIM states from bound or connected sockets", () => {
  const base = { LocalAddress: "192.0.2.10", LocalPort: 3000, RemotePort: 0 };
  const listening = { ...base, State: 2, OwningProcess: 100 };
  const unknown = { ...base, State: 0, OwningProcess: 101 };
  const records = [
    listening,
    unknown,
    { ...base, State: "Bound", OwningProcess: 102 },
    { ...base, State: 5, RemotePort: 4000, OwningProcess: 103 },
    { ...base, State: 2, OwningProcess: 0 },
  ];
  expect(parseWindowsPortOwners(JSON.stringify(records), [3000], [])).toEqual([
    listening,
    unknown,
  ]);
  expect(
    parseWindowsPortOwners(JSON.stringify(records), [3000], [101])
  ).toEqual([listening]);
  expect(parseWindowsPortOwners(JSON.stringify(listening), [3000], [])).toEqual(
    [listening]
  );
  expect(parseWindowsPortOwners("", [3000], [])).toEqual([]);
  expect(windowsListenerProbeHost("192.0.2.10")).toBe("192.0.2.10");
  expect(windowsListenerProbeHost("0.0.0.0")).toBe("127.0.0.1");
  expect(windowsListenerProbeHost("::")).toBe("::1");
});

test("fallback discovery deduplicates endpoints and admits at most four TCP probes", async () => {
  const records = Array.from({ length: 12 }, (_, index) => ({
    LocalAddress: "192.0.2.10",
    LocalPort: 4000 + index,
    RemotePort: 0,
    State: null,
    OwningProcess: 100 + index,
  }));
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  const owners = await findWindowsListeningPids(
    JSON.stringify([...records, ...records]),
    records.map((record) => record.LocalPort),
    [],
    async () => {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Bun.sleep(1);
      active -= 1;
      return true;
    }
  );
  expect(calls).toBe(12);
  expect(maximumActive).toBeLessThanOrEqual(4);
  expect(owners).toEqual(records.map((record) => record.OwningProcess));
});

test("unknown states require a successful probe and a concrete address", async () => {
  const records = [
    {
      LocalAddress: "192.0.2.10",
      LocalPort: 3000,
      RemotePort: 0,
      State: null,
      OwningProcess: 100,
    },
    {
      LocalAddress: "",
      LocalPort: 3000,
      RemotePort: 0,
      State: 0,
      OwningProcess: 101,
    },
    {
      LocalAddress: "192.0.2.10",
      LocalPort: 3001,
      RemotePort: 0,
      State: 2,
      OwningProcess: 102,
    },
  ];
  expect(
    await findWindowsListeningPids(
      JSON.stringify(records),
      [3000, 3001],
      [],
      () => Promise.reject(new Error("unreachable"))
    )
  ).toEqual([102]);
  expect(
    await findWindowsListeningPids(
      JSON.stringify(records),
      [3000, 3001],
      [],
      () => Promise.resolve(false)
    )
  ).toEqual([102]);
});

test("a successful connection cannot confirm multiple owners of an ambiguous endpoint", async () => {
  const base = {
    LocalAddress: "192.0.2.10",
    LocalPort: 3000,
    RemotePort: 0,
    State: null,
  };
  const records = [
    { ...base, OwningProcess: 100 },
    { ...base, OwningProcess: 101 },
  ];
  let probes = 0;
  expect(
    await findWindowsListeningPids(JSON.stringify(records), [3000], [], () => {
      probes += 1;
      return Promise.resolve(true);
    })
  ).toEqual([]);
  expect(probes).toBe(0);
});
