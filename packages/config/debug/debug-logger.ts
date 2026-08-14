// The dev/build bundles this module into BOTH server and client. In the
// browser, console output is spam the user does not want (dev server terminal
// and OpenTelemetry are the only sanctioned log sinks), so every logger here
// no-ops when running in a browser context.

const IS_BROWSER = typeof window !== "undefined";
const DEBUG = process.env.NODE_ENV === "development";

const noop = (..._args: unknown[]): void => undefined;

// Escapes a single control character for safe embedding in a log line. ASCII
// whitespace gets readable names; everything else (C0/C1 controls, DEL, the
// Unicode line/paragraph separators) becomes an explicit four-digit \uXXXX
// escape so the sink can never be coerced into rendering a line break.
function escapeControlChar(code: number): string {
  if (code === 0x0a) {
    return "\\n";
  }
  if (code === 0x0d) {
    return "\\r";
  }
  if (code === 0x09) {
    return "\\t";
  }
  return `\\u${code.toString(16).padStart(4, "0")}`;
}

// True for characters that can inject or corrupt a log line: C0 controls
// (0x00-0x1F), DEL and C1 controls (0x7F-0x9F), plus the Unicode line and
// paragraph separators U+2028 and U+2029.
function isControlChar(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x20_28 ||
    code === 0x20_29
  );
}

// Sanitizes a string so embedded control characters cannot inject fake log
// lines (CodeQL "log injection").
function sanitizeString(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    result += isControlChar(code) ? escapeControlChar(code) : char;
  }
  return result;
}

// Sanitizes values before they reach the log sink so user-controlled input
// (post content, usernames, error messages) cannot inject fake log lines via
// embedded newlines or other control characters. This closes the CodeQL
// "log injection" finding.
function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (value instanceof Error) {
    // Keep the full stack when present so server-side failures stay
    // traceable in dev; fall back to name + message if no stack exists.
    return sanitizeString(value.stack ?? `${value.name}: ${value.message}`);
  }
  if (value && typeof value === "object") {
    try {
      return sanitizeString(JSON.stringify(value));
    } catch {
      return "[Unserializable object]";
    }
  }
  return value;
}

function safeArgs(args: unknown[]): unknown[] {
  return args.map(sanitize);
}

export const debugLog = {
  api: (...args: unknown[]) => {
    if (IS_BROWSER) {
      return;
    }
    if (DEBUG) {
      console.log(`[API ${new Date().toISOString()}]`, ...safeArgs(args));
    }
  },
  cache: (...args: unknown[]) => {
    if (IS_BROWSER) {
      return;
    }
    if (DEBUG) {
      console.log(`[Cache ${new Date().toISOString()}]`, ...safeArgs(args));
    }
  },
  component: (...args: unknown[]) => {
    if (IS_BROWSER) {
      return;
    }
    if (DEBUG) {
      console.log(`[Component ${new Date().toISOString()}]`, ...safeArgs(args));
    }
  },
  mutation: (...args: unknown[]) => {
    if (IS_BROWSER) {
      return;
    }
    if (DEBUG) {
      console.log(`[Mutation ${new Date().toISOString()}]`, ...safeArgs(args));
    }
  },
  state: (...args: unknown[]) => {
    if (IS_BROWSER) {
      return;
    }
    if (DEBUG) {
      console.log(`[State ${new Date().toISOString()}]`, ...safeArgs(args));
    }
  },
  views: (...args: unknown[]) => {
    if (IS_BROWSER) {
      return;
    }
    if (DEBUG) {
      console.log(`[Views ${new Date().toISOString()}]`, ...safeArgs(args));
    }
  },
} as const;

// Client-safe replacements for raw console.* calls in client components. They
// write nothing in the browser (terminal/OTEL are the only sinks); on the
// server they fall through to the real console so a file reused server-side
// still logs. Values are sanitized for the same log-injection reason as
// debugLog.
function makeClientMethod(method: "log" | "error" | "warn" | "info" | "debug") {
  if (IS_BROWSER) {
    return noop;
  }
  return (...args: unknown[]) => {
    console[method](...safeArgs(args));
  };
}

export const clientLog = {
  debug: makeClientMethod("debug"),
  error: makeClientMethod("error"),
  info: makeClientMethod("info"),
  log: makeClientMethod("log"),
  warn: makeClientMethod("warn"),
} as const;
