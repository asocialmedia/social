import { describe, expect, test } from "bun:test";

import {
  isTerminalStatus,
  rejectionCopy,
  stageForStatus,
  uploadProgressInfo,
} from "./upload-status";

describe("stageForStatus", () => {
  test("maps the server lifecycle to composer stages", () => {
    expect(stageForStatus("UPLOADING")).toBe("uploading");
    expect(stageForStatus("QUARANTINED")).toBe("queued");
    expect(stageForStatus("SCANNING")).toBe("scanning");
    expect(stageForStatus("PROCESSING")).toBe("processing");
    expect(stageForStatus("READY")).toBe("ready");
    expect(stageForStatus("REJECTED")).toBe("error");
  });
});

describe("isTerminalStatus", () => {
  test("treats READY and every rejection as terminal", () => {
    expect(isTerminalStatus("READY")).toBe(true);
    expect(isTerminalStatus("FAILED")).toBe(true);
    expect(isTerminalStatus("SCANNING")).toBe(false);
  });
});

describe("rejectionCopy", () => {
  test("uses web's copy per reason with a generic fallback", () => {
    expect(rejectionCopy("MALWARE")).toBe(
      "Security scan found a threat in this file."
    );
    expect(rejectionCopy(null)).toBe("This attachment was rejected.");
  });
});

describe("uploadProgressInfo", () => {
  test("maps bytes into 1-50% and server stages to fixed steps", () => {
    expect(uploadProgressInfo("uploading", 0)).toEqual({
      label: "1% · Uploading…",
      percent: 1,
    });
    expect(uploadProgressInfo("uploading", 100).percent).toBe(50);
    expect(uploadProgressInfo("queued", 100).percent).toBe(55);
    expect(uploadProgressInfo("scanning", 100).percent).toBe(75);
    expect(uploadProgressInfo("processing", 100).label).toBe(
      "90% · Processing…"
    );
  });
});
