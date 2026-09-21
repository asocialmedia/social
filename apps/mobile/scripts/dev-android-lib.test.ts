import { describe, expect, test } from "bun:test";

import {
  DEV_REVERSE_PORTS,
  buildAdbReverseArgs,
  buildExpoArgs,
  hasOfflineEmulator,
  parseAdbDevices,
  parseDevAndroidArgs,
  pickDeviceSerial,
  resolveExpoDeviceName,
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

const ADB_LONG_OUTPUT = `List of devices attached
emulator-5556          device product:sdk_gphone16k_x86_64 model:sdk_gphone16k_x86_64 device:emu64xa16k transport_id:12
R58M12ABCDE            device usb:1-2 product:beyond1 model:SM_G973F device:beyond1 transport_id:4
`;

describe("resolveExpoDeviceName", () => {
  test("emulators resolve to the AVD name Expo displays", () => {
    expect(
      resolveExpoDeviceName(
        "emulator-5556",
        ADB_LONG_OUTPUT,
        "Pixel_10_Pro\nOK\n"
      )
    ).toBe("Pixel_10_Pro");
  });

  test("phones resolve to their model", () => {
    expect(resolveExpoDeviceName("R58M12ABCDE", ADB_LONG_OUTPUT, null)).toBe(
      "SM_G973F"
    );
  });

  test("falls back to Expo's generic label", () => {
    expect(resolveExpoDeviceName("ZZZ", ADB_LONG_OUTPUT, null)).toBe(
      "Device ZZZ"
    );
    expect(resolveExpoDeviceName("emulator-5558", "", null)).toBe(
      "Device emulator-5558"
    );
  });
});

describe("buildExpoArgs", () => {
  test("dev client runs on the chosen device", () => {
    expect(
      buildExpoArgs({ deviceName: "Pixel_10_Pro", go: false, port: 8082 })
    ).toEqual([
      "expo",
      "run:android",
      "--device",
      "Pixel_10_Pro",
      "--port",
      "8082",
    ]);
  });

  test("expo go fallback starts the packager only", () => {
    expect(
      buildExpoArgs({ deviceName: "Pixel_10_Pro", go: true, port: 8082 })
    ).toEqual(["expo", "start", "-p", "8082", "--go"]);
  });
});
