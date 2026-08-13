import { describe, expect, spyOn, test } from "bun:test";
import { clientLog } from "./debug-logger";

// The public logger (clientLog) is active server-side regardless of NODE_ENV,
// so these tests verify its sanitization end to end by capturing console output.

function captureConsole(method: "log" | "error") {
  const spy = spyOn(console, method);
  return {
    spy,
    firstArg() {
      const [call] = spy.mock.calls;
      if (!call) {
        throw new Error(`console.${method} was never called`);
      }
      const [first] = call;
      return first;
    },
  };
}

describe("clientLog sanitization", () => {
  test("newline, carriage return, and tab become readable escapes", () => {
    const { spy, firstArg } = captureConsole("log");
    try {
      clientLog.log("line1\nline2\r\n\ttabbed");
      expect(firstArg()).toBe("line1\\nline2\\r\\n\\ttabbed");
    } finally {
      spy.mockRestore();
    }
  });

  test("C0 controls become literal \\uXXXX escapes", () => {
    const { spy, firstArg } = captureConsole("log");
    try {
      // NUL and other non-whitespace C0 controls have no readable escape
      clientLog.log("a\x00b\x01c\x1fd");
      expect(firstArg()).toBe("a\\u0000b\\u0001c\\u001fd");
    } finally {
      spy.mockRestore();
    }
  });

  test("DEL and C1 controls become literal \\uXXXX escapes", () => {
    const { spy, firstArg } = captureConsole("log");
    try {
      clientLog.log("del\x7f\u0080\u009fend");
      expect(firstArg()).toBe("del\\u007f\\u0080\\u009fend");
    } finally {
      spy.mockRestore();
    }
  });

  test("Unicode line and paragraph separators (U+2028/U+2029) are escaped", () => {
    const { spy, firstArg } = captureConsole("log");
    try {
      clientLog.log("a\u2028b\u2029c");
      expect(firstArg()).toBe("a\\u2028b\\u2029c");
    } finally {
      spy.mockRestore();
    }
  });

  test("an Error with a multiline stack retains the complete sanitized stack", () => {
    const { spy, firstArg } = captureConsole("error");
    try {
      const error = new Error("boom\ninjected line");
      error.stack =
        "Error: boom\ninjected line\n    at one (file.ts:1:2)\n    at two (file.ts:3:4)\n    at three (file.ts:5:6)";
      clientLog.error(error);
      const sanitized = firstArg();
      // Every newline is escaped so no log line can be injected
      expect(sanitized).not.toContain("\n");
      // The full stack is preserved (message + every frame) in escape form
      expect(sanitized).toContain("Error: boom\\ninjected line");
      expect(sanitized).toContain("at one (file.ts:1:2)");
      expect(sanitized).toContain("at two (file.ts:3:4)");
      expect(sanitized).toContain("at three (file.ts:5:6)");
    } finally {
      spy.mockRestore();
    }
  });
});
