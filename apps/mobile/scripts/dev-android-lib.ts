// Pure helpers for scripts/dev-android.ts: no process spawning, so the
// argument building and device selection are unit-testable under bun.

// Ports the emulator must reach on this machine as `localhost`:
//   3000 web (API + auth proxy + Turnstile page origin)
//   3001 auth service (OAuth providers redirect the browser here)
//   8082 Metro (expo start / run:android; Expo also reverses this itself)
export const DEV_REVERSE_PORTS = [3000, 3001, 8082] as const;

export const METRO_PORT = 8082;

export interface AdbDevice {
  serial: string;
  state: string;
}

/** Parses `adb devices` output into serial/state pairs (header dropped). */
export function parseAdbDevices(output: string): AdbDevice[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("List of devices"))
    .map((line) => {
      const [serial = "", state = ""] = line.split(/\s+/);
      return { serial, state };
    })
    .filter((device) => device.serial.length > 0);
}

/**
 * Picks the device to run on. A stale entry (like an `offline` emulator left
 * behind by a previous session) must never win, and an explicit `preferred`
 * serial is honoured only when it is actually online.
 */
export function pickDeviceSerial(
  output: string,
  preferred?: string
): string | null {
  const online = parseAdbDevices(output).filter(
    (device) => device.state === "device"
  );
  if (preferred) {
    return online.some((device) => device.serial === preferred)
      ? preferred
      : null;
  }
  const emulator = online.find((device) =>
    device.serial.startsWith("emulator-")
  );
  return (emulator ?? online[0])?.serial ?? null;
}

// Expo's `--device` flag matches the DISPLAY name it derives itself, not the
// adb serial: the AVD name for emulators (`adb emu avd name`), the `model:`
// field of `adb devices -l` for phones, else `Device <serial>`. Mirrors the
// Expo CLI's start/platforms/android/adb.ts so the flag resolves.
export function resolveExpoDeviceName(
  serial: string,
  devicesLongOutput: string,
  avdName: string | null
): string {
  if (serial.startsWith("emulator-")) {
    const name = avdName?.split("\n")[0]?.trim();
    if (name) {
      return name;
    }
  }
  const line = devicesLongOutput
    .split("\n")
    .find((entry) => entry.trim().startsWith(serial));
  const model = line
    ?.split(/\s+/)
    .find((field) => field.startsWith("model:"))
    ?.slice("model:".length);
  return model || `Device ${serial}`;
}

// A dead emulator leaves an `emulator-XXXX offline` row behind until the adb
// server restarts. Expo's device enumeration asks every emulator for its AVD
// name and aborts on that row, so the script must clear it first.
export function hasOfflineEmulator(output: string): boolean {
  return parseAdbDevices(output).some(
    (device) =>
      device.serial.startsWith("emulator-") && device.state === "offline"
  );
}

export function buildAdbReverseArgs(serial: string, port: number): string[] {
  return ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`];
}

export interface DevAndroidOptions {
  device?: string;
  go: boolean;
  reverseOnly: boolean;
}

/** Parses the script's CLI flags. Unknown flags are ignored on purpose. */
export function parseDevAndroidArgs(argv: string[]): DevAndroidOptions {
  const options: DevAndroidOptions = { go: false, reverseOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--go") {
      options.go = true;
    } else if (arg === "--reverse-only") {
      options.reverseOnly = true;
    } else if (arg === "--device") {
      const value = argv[index + 1];
      if (value && !value.startsWith("-")) {
        options.device = value;
        index += 1;
      }
    } else if (arg?.startsWith("--device=")) {
      options.device = arg.slice("--device=".length);
    }
  }
  return options;
}

/** Arguments for `bunx expo ...` after the reverses are in place. */
export function buildExpoArgs(options: {
  deviceName: string;
  go: boolean;
  port: number;
}): string[] {
  if (options.go) {
    return ["expo", "start", "-p", String(options.port), "--go"];
  }
  return [
    "expo",
    "run:android",
    "--device",
    options.deviceName,
    "--port",
    String(options.port),
  ];
}
