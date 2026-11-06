import { expect, test } from "bun:test";

import {
  parseWindowsPortOwners,
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
