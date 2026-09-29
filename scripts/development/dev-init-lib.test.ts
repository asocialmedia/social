import { describe, expect, test } from "bun:test";

import {
  buildMarker,
  fingerprintContract,
  missingExtensions,
  parseExtensionList,
  parseMarker,
  REQUIRED_EXTENSIONS,
  shouldEmitContract,
  shouldInstallExtensions,
  shouldRunInitProfile,
  shouldSyncSkills,
  shouldUpdateDatabase,
} from "./dev-init-lib";
import { MARKER_VERSION } from "./dev-init-lib";

const contractFingerprint = fingerprintContract("model User {}");

describe("parseMarker", () => {
  test("round-trips a marker", () => {
    const marker = buildMarker(contractFingerprint, REQUIRED_EXTENSIONS);

    expect(parseMarker(JSON.stringify(marker))).toEqual(marker);
  });

  test("rejects a missing or unparseable marker", () => {
    expect(parseMarker(null)).toBeNull();
    expect(parseMarker("")).toBeNull();
    expect(parseMarker("not json")).toBeNull();
    expect(parseMarker("[]")).toBeNull();
  });

  test("rejects a marker from an older version rather than trusting it", () => {
    const stale = JSON.stringify({
      contractFingerprint,
      extensions: ["pgcrypto"],
      initializedAt: "2026-01-01T00:00:00.000Z",
      version: MARKER_VERSION - 1,
    });

    expect(parseMarker(stale)).toBeNull();
  });

  test("drops non-string entries from extensions", () => {
    const marker = parseMarker(
      JSON.stringify({
        contractFingerprint,
        extensions: ["pgcrypto", 7, null],
        initializedAt: "2026-01-01T00:00:00.000Z",
        version: MARKER_VERSION,
      })
    );

    expect(marker?.extensions).toEqual(["pgcrypto"]);
  });
});

describe("fingerprintContract", () => {
  test("is stable for the same source and changes when it does", () => {
    expect(fingerprintContract("a")).toBe(fingerprintContract("a"));
    expect(fingerprintContract("a")).not.toBe(fingerprintContract("b"));
  });
});

describe("parseExtensionList", () => {
  test("splits psql output into names and drops blank lines", () => {
    expect(parseExtensionList("pgcrypto\npg_trgm\n\n  uuid-ossp  \n")).toEqual([
      "pgcrypto",
      "pg_trgm",
      "uuid-ossp",
    ]);
  });

  test("handles empty output", () => {
    expect(parseExtensionList("")).toEqual([]);
  });
});

describe("missingExtensions", () => {
  test("reports only what is absent", () => {
    expect(missingExtensions(["pgcrypto", "pg_trgm"])).toEqual([
      "pg_stat_statements",
      "uuid-ossp",
    ]);
  });

  test("reports nothing when everything is present", () => {
    expect(missingExtensions(REQUIRED_EXTENSIONS)).toEqual([]);
  });
});

describe("shouldInstallExtensions", () => {
  test("skips when every extension is present", () => {
    const decision = shouldInstallExtensions(REQUIRED_EXTENSIONS);

    expect(decision.run).toBe(false);
  });

  test("runs when the database is fresh", () => {
    const decision = shouldInstallExtensions([]);

    expect(decision.run).toBe(true);
    expect(decision.reason).toContain("pgcrypto");
  });

  test("trusts the database, not a marker that claims otherwise", () => {
    // A marker can survive while the volume is recreated. The live database is
    // the only authority here.
    const decision = shouldInstallExtensions([]);

    expect(decision.run).toBe(true);
  });
});

describe("shouldSyncSkills", () => {
  test("skips when the synced version matches the installed package", () => {
    expect(shouldSyncSkills("8.0.0-rc.11", "8.0.0-rc.11").run).toBe(false);
  });

  test("runs on a dependency bump", () => {
    const decision = shouldSyncSkills("8.0.0-rc.12", "8.0.0-rc.11");

    expect(decision.run).toBe(true);
    expect(decision.reason).toContain("8.0.0-rc.12");
  });

  test("runs when nothing has been synced yet", () => {
    expect(shouldSyncSkills("8.0.0-rc.11", null).run).toBe(true);
  });
});

describe("shouldEmitContract", () => {
  const base = {
    contractDTsMtimeMs: 200,
    contractJsonMtimeMs: 200,
    contractSourceMtimeMs: 100,
    sourceExists: true,
  };

  test("skips when the artefacts are newer than the source", () => {
    expect(shouldEmitContract(base).run).toBe(false);
  });

  test("runs when the source was just edited", () => {
    const decision = shouldEmitContract({
      ...base,
      contractSourceMtimeMs: 300,
    });

    expect(decision.run).toBe(true);
  });

  test("runs when an artefact is missing", () => {
    expect(shouldEmitContract({ ...base, contractDTsMtimeMs: 0 }).run).toBe(
      true
    );
    expect(shouldEmitContract({ ...base, contractJsonMtimeMs: 0 }).run).toBe(
      true
    );
  });

  test("runs when the source does not exist at all", () => {
    expect(shouldEmitContract({ ...base, sourceExists: false }).run).toBe(true);
  });

  test("treats an artefact one millisecond older as stale", () => {
    const decision = shouldEmitContract({
      ...base,
      contractSourceMtimeMs: 201,
    });

    expect(decision.run).toBe(true);
  });
});

describe("shouldUpdateDatabase", () => {
  const marker = buildMarker(contractFingerprint, REQUIRED_EXTENSIONS);

  test("skips the steady-state repeat start", () => {
    const decision = shouldUpdateDatabase({
      contractFingerprint,
      facts: { verifyExitCode: 0 },
      marker,
    });

    expect(decision.run).toBe(false);
  });

  test("skips on a first run when the database already matches", () => {
    // No marker yet, but verify is clean: the schema is already right, so
    // there is nothing to apply.
    const decision = shouldUpdateDatabase({
      contractFingerprint,
      facts: { verifyExitCode: 0 },
      marker: null,
    });

    expect(decision.run).toBe(false);
  });

  test("runs when the contract changed since the last apply", () => {
    const decision = shouldUpdateDatabase({
      contractFingerprint: fingerprintContract("model User { id Int }"),
      facts: { verifyExitCode: 0 },
      marker,
    });

    expect(decision.run).toBe(true);
    expect(decision.reason).toContain("contract changed");
  });

  test("runs when verify finds drift, even with a matching fingerprint", () => {
    // A hand edit to the database leaves the contract untouched, so the
    // fingerprint still matches. Verify is what catches it.
    const decision = shouldUpdateDatabase({
      contractFingerprint,
      facts: { verifyExitCode: 4 },
      marker,
    });

    expect(decision.run).toBe(true);
    expect(decision.reason).toContain("findings");
  });

  test("runs when verify could not run at all", () => {
    const decision = shouldUpdateDatabase({
      contractFingerprint,
      facts: { verifyExitCode: null },
      marker,
    });

    expect(decision.run).toBe(true);
  });
});

describe("shouldRunInitProfile", () => {
  test("follows the extension decision", () => {
    expect(shouldRunInitProfile(shouldInstallExtensions([])).run).toBe(true);
    expect(
      shouldRunInitProfile(shouldInstallExtensions(REQUIRED_EXTENSIONS)).run
    ).toBe(false);
  });
});
