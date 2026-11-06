import { expect, test } from "bun:test";

import { parseWindowsPortOwners } from "./platform-listeners";

test("Windows port owners are filtered by local port and PID exclusions", () => {
  const stdout = JSON.stringify([
    { LocalPort: 3000, OwningProcess: 100 },
    { LocalPort: 3001, OwningProcess: 101 },
    { LocalPort: 8000, OwningProcess: 102 },
    { LocalPort: 3012, OwningProcess: 103 },
    { LocalPort: 3000, OwningProcess: 0 },
    { LocalPort: 3000, OwningProcess: "invalid" },
  ]);

  expect(parseWindowsPortOwners(stdout, [3000, 3001, 3012], [101])).toEqual([
    { LocalPort: 3000, OwningProcess: 100 },
    { LocalPort: 3012, OwningProcess: 103 },
  ]);
  expect(parseWindowsPortOwners(stdout, [], [])).toEqual([]);
  expect(parseWindowsPortOwners("", [3000], [])).toEqual([]);
  expect(parseWindowsPortOwners("[]", [3000], [])).toEqual([]);
});

test("Windows port owners accept PowerShell's single-record JSON format", () => {
  const record = { LocalPort: 3000, OwningProcess: 100 };
  expect(parseWindowsPortOwners(JSON.stringify(record), [3000], [])).toEqual([
    record,
  ]);
});
