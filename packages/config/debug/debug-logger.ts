// The dev/build bundles this module into BOTH server and client. In the
// browser, console output is spam the user does not want (dev server terminal
// and OpenTelemetry are the only sanctioned log sinks), so every logger here
// no-ops when running in a browser context.

const IS_BROWSER = typeof window !== "undefined";
const DEBUG = process.env.NODE_ENV === "development";

const noop = (..._args: unknown[]): void => undefined;

export const debugLog = {
  // biome-ignore lint/suspicious/noExplicitAny: any is used to allow for any number of arguments
  cache: (...args: any[]) => {
    if (IS_BROWSER) {
      return;
    }
    if (DEBUG) {
      console.log(`[Cache ${new Date().toISOString()}]`, ...args);
    }
  },
  // biome-ignore lint/suspicious/noExplicitAny: same as above
  views: (...args: any[]) => {
    if (IS_BROWSER) {
      return;
    }
    if (DEBUG) {
      console.log(`[Views ${new Date().toISOString()}]`, ...args);
    }
  },
  // biome-ignore lint/suspicious/noExplicitAny: same as above
  mutation: (...args: any[]) => {
    if (IS_BROWSER) {
      return;
    }
    if (DEBUG) {
      console.log(`[Mutation ${new Date().toISOString()}]`, ...args);
    }
  },
  // biome-ignore lint/suspicious/noExplicitAny: same as above
  api: (...args: any[]) => {
    if (IS_BROWSER) {
      return;
    }
    if (DEBUG) {
      console.log(`[API ${new Date().toISOString()}]`, ...args);
    }
  },
  // biome-ignore lint/suspicious/noExplicitAny: same as above
  component: (...args: any[]) => {
    if (IS_BROWSER) {
      return;
    }
    if (DEBUG) {
      console.log(`[Component ${new Date().toISOString()}]`, ...args);
    }
  },
  // biome-ignore lint/suspicious/noExplicitAny: same as above
  state: (...args: any[]) => {
    if (IS_BROWSER) {
      return;
    }
    if (DEBUG) {
      console.log(`[State ${new Date().toISOString()}]`, ...args);
    }
  },
} as const;

// Client-safe replacements for raw console.* calls in client components. They
// write nothing in the browser (terminal/OTEL are the only sinks); on the
// server they fall through to the real console so a file reused server-side
// still logs. Use these in any code that is bundled into the browser.
export const clientLog = {
  log: IS_BROWSER ? noop : console.log.bind(console),
  error: IS_BROWSER ? noop : console.error.bind(console),
  warn: IS_BROWSER ? noop : console.warn.bind(console),
  info: IS_BROWSER ? noop : console.info.bind(console),
  debug: IS_BROWSER ? noop : console.debug.bind(console),
} as const;
