import { describe, expect, test } from "bun:test";

import {
  DEV_REVERSE_PORTS,
  METRO_PORT,
  buildAdbReverseArgs,
  buildBootCompletedArgs,
  buildExpoArgs,
  findNewEmulatorSerial,
  hasAllReverses,
  hasOfflineEmulator,
  isBootCompleted,
  parseAdbDevices,
  parseDevAndroidArgs,
  pickDeviceSerial,
} from "./dev-android-lib";

const ADB_OUTPUT = `List of devices attached
emulator-5554\toffline
emulator-5556\tdevice
R58M12ABCDE\tdevice
`;

describe("parseAdbDevices", () => {
  test("drops the header and blank lines", () => {
    expect(parseAdbDevices(ADB_OUTPUT)).toEqual([
      { serial: "emulator-5554", state: "offline" },
      { serial: "emulator-5556", state: "device" },
      { serial: "R58M12ABCDE", state: "device" },
    ]);
  });

  test("handles an empty device list", () => {
    expect(parseAdbDevices("List of devices attached\n\n")).toEqual([]);
  });
});

describe("hasOfflineEmulator", () => {
  test("flags a stale emulator row", () => {
    expect(hasOfflineEmulator(ADB_OUTPUT)).toBe(true);
    expect(
      hasOfflineEmulator("List of devices attached\nemulator-5556\tdevice\n")
    ).toBe(false);
    expect(
      hasOfflineEmulator("List of devices attached\nR58M12ABCDE\toffline\n")
    ).toBe(false);
  });
});

describe("pickDeviceSerial", () => {
  test("skips offline emulators and prefers an online emulator", () => {
    expect(pickDeviceSerial(ADB_OUTPUT)).toBe("emulator-5556");
  });

  test("falls back to a physical device when no emulator is online", () => {
    expect(
      pickDeviceSerial("List of devices attached\nR58M12ABCDE\tdevice\n")
    ).toBe("R58M12ABCDE");
  });

  test("honours a preferred serial only when it is online", () => {
    expect(pickDeviceSerial(ADB_OUTPUT, "R58M12ABCDE")).toBe("R58M12ABCDE");
    expect(pickDeviceSerial(ADB_OUTPUT, "emulator-5554")).toBeNull();
  });

  test("returns null when nothing is connected", () => {
    expect(pickDeviceSerial("List of devices attached\n")).toBeNull();
  });
});

describe("buildAdbReverseArgs", () => {
  test("targets the serial and mirrors the port", () => {
    expect(buildAdbReverseArgs("emulator-5556", 3000)).toEqual([
      "-s",
      "emulator-5556",
      "reverse",
      "tcp:3000",
      "tcp:3000",
    ]);
  });

  test("covers web, auth and Metro", () => {
    expect([...DEV_REVERSE_PORTS]).toEqual([3000, 3001, 8082]);
  });
});

describe("parseDevAndroidArgs", () => {
  test("defaults to a dev-client run", () => {
    expect(parseDevAndroidArgs([])).toEqual({ go: false, reverseOnly: false });
  });

  test("reads flags in either form", () => {
    expect(parseDevAndroidArgs(["--go", "--device", "emulator-5556"])).toEqual({
      device: "emulator-5556",
      go: true,
      reverseOnly: false,
    });
    expect(parseDevAndroidArgs(["--device=abc", "--reverse-only"])).toEqual({
      device: "abc",
      go: false,
      reverseOnly: true,
    });
  });

  test("does not swallow a following flag as the device value", () => {
    expect(parseDevAndroidArgs(["--device", "--go"])).toEqual({
      go: true,
      reverseOnly: false,
    });
  });
});

describe("buildExpoArgs", () => {
  test("keeps the selected ADB serial when an emulator has no console name", () => {
    const deviceSerial = pickDeviceSerial(ADB_OUTPUT, "emulator-5556");
    expect(deviceSerial).not.toBeNull();
    if (!deviceSerial) {
      throw new Error("Expected an online emulator");
    }
    const args = buildExpoArgs({ deviceSerial, go: false, port: METRO_PORT });
    expect(args[args.indexOf("--device") + 1]).toBe("emulator-5556");
  });

  test("dev client runs on the chosen device", () => {
    expect(
      buildExpoArgs({ deviceSerial: "emulator-5556", go: false, port: 8082 })
    ).toEqual([
      "expo",
      "run:android",
      "--device",
      "emulator-5556",
      "--port",
      "8082",
    ]);
  });

  test("expo go fallback starts the packager only", () => {
    expect(
      buildExpoArgs({ deviceSerial: "emulator-5556", go: true, port: 8082 })
    ).toEqual(["expo", "start", "-p", "8082", "--go"]);
  });
});

describe("isBootCompleted", () => {
  test("accepts exactly 1, ignoring surrounding whitespace", () => {
    expect(isBootCompleted("1\n")).toBe(true);
    expect(isBootCompleted("0\n")).toBe(false);
    expect(isBootCompleted("")).toBe(false);
  });

  test("builds the getprop args for a serial", () => {
    expect(buildBootCompletedArgs("emulator-5556")).toEqual([
      "-s",
      "emulator-5556",
      "shell",
      "getprop",
      "sys.boot_completed",
    ]);
  });
});

const REVERSE_LIST = `emulator-5556 tcp:3000 tcp:3000
emulator-5556 tcp:3001 tcp:3001
emulator-5556 tcp:8082 tcp:8082
`;

describe("hasAllReverses", () => {
  test("passes when every port is listed", () => {
    expect(hasAllReverses(REVERSE_LIST, DEV_REVERSE_PORTS)).toBe(true);
  });

  test("fails when a port is missing", () => {
    expect(
      hasAllReverses("emulator-5556 tcp:8082 tcp:8082\n", DEV_REVERSE_PORTS)
    ).toBe(false);
  });

  test("rejects a longer host port near-miss", () => {
    expect(hasAllReverses("emulator-5556 tcp:3000 tcp:30001\n", [3000])).toBe(
      false
    );
  });
});

describe("findNewEmulatorSerial", () => {
  test("prefers the launched emulator over an existing one coming online", () => {
    const before = "List of devices attached\nemulator-5554\toffline\n";
    const after = `List of devices attached
emulator-5554\tdevice
emulator-5556\tdevice
`;
    expect(findNewEmulatorSerial(before, after)).toBe("emulator-5556");
  });

  test("ignores already-online emulators and offline rows", () => {
    const snapshot = "List of devices attached\nemulator-5554\tdevice\n";
    expect(findNewEmulatorSerial(snapshot, snapshot)).toBeNull();
    expect(
      findNewEmulatorSerial(
        snapshot,
        "List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\n"
      )
    ).toBeNull();
  });
});
