// Edge-runtime safe. @asm/logger is Node-only (uses node:stream / process.stderr)
// so it is imported lazily inside initWebTelemetry, which is itself only
// reached on the Node.js runtime. Statically importing it here would pull the
// Node module into the Edge (proxy/middleware) bundle and fail to compile.

// Supports both pino calling conventions: structured (obj, message) and the
// plain console-style (message) used by forwarded console output.
type LogFn = ((obj: object, message?: string) => void) &
  ((message: string) => void);

interface PinoLogger {
  debug: LogFn;
  error: LogFn;
  info: LogFn;
  warn: LogFn;
}

let webLogger: PinoLogger | undefined;

function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") {
    return arg;
  }
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function toMessage(args: unknown[]): string {
  return args.map(stringifyArg).join(" ");
}

type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";
type LogMethod = "debug" | "error" | "info" | "warn";

const CONSOLE_TO_PINO: Record<ConsoleMethod, LogMethod> = {
  debug: "debug",
  error: "error",
  info: "info",
  log: "info",
  warn: "warn",
};

// Forwards the Next.js server's console output into the pino logger (and thus
// OpenObserve under the configured stream, e.g. asm_web_logs). The original
// console methods still run so terminal output and Dokploy logs are unchanged.
function forwardConsoleOutput(logger: PinoLogger): void {
  const consoleRef = console as Record<
    ConsoleMethod,
    (...args: unknown[]) => void
  >;

  for (const method of Object.keys(CONSOLE_TO_PINO) as ConsoleMethod[]) {
    const original = consoleRef[method]?.bind(console);
    if (!original) {
      continue;
    }
    const pinoLevel = CONSOLE_TO_PINO[method];
    consoleRef[method] = (...args: unknown[]) => {
      original(...args);
      logger[pinoLevel](toMessage(args));
    };
  }
}

let initialized = false;

// Boots the web app's OpenTelemetry stack: traces, metrics and logs ship to
// OpenObserve under the asm_web_* streams. Safe to call repeatedly; only runs
// on the Node.js server runtime and only when an OTLP endpoint is configured
// (so `next build` stays offline, unset environments are no-ops, and the Edge
// runtime never touches the Node-only @asm/logger module).
export async function initWebTelemetry(): Promise<void> {
  if (initialized || process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    process.env.OPENOBSERVE_ENDPOINT ??
    process.env.ZO_ENDPOINT;
  if (!endpoint) {
    return;
  }

  const { createLogger, initTelemetry } = await import("@asm/logger");
  const logger = createLogger({
    level: process.env.LOG_LEVEL ?? "info",
    serviceName: "web",
  });
  const telemetry = initTelemetry({ serviceName: "web", version: "1.1.85" });

  initialized = true;
  webLogger = logger;
  forwardConsoleOutput(webLogger);

  // Tear down exporters cleanly on shutdown.
  process.once("exit", () => {
    void telemetry.shutdown();
  });
}

export function getWebLogger(): PinoLogger | undefined {
  return webLogger;
}
