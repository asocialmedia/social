import { describe, expect, test } from "bun:test";

import {
  getAccountMergedEmailHtml,
  getBackupCodesRegeneratedEmailHtml,
  getPasskeyChangedEmailHtml,
  getUsernameChangedEmailHtml,
} from "./credential-notice-emails";

const AT = "18 October 2026 at 14:32 UTC";

describe("credential notice emails", () => {
  test("passkey added names the passkey", async () => {
    const html = await getPasskeyChangedEmailHtml({
      action: "added",
      changedAt: AT,
      passkeyName: "MacBook Touch ID",
    });

    expect(html).toContain("A passkey was added");
    expect(html).toContain("MacBook Touch ID");
    expect(html).toContain(AT);
  });

  test("passkey removed keeps the other methods working", async () => {
    const html = await getPasskeyChangedEmailHtml({
      action: "removed",
      changedAt: AT,
      passkeyName: "Old phone",
    });

    expect(html).toContain("A passkey was removed");
    expect(html).toContain("still work");
  });

  test("backup codes notice states the old set is dead", async () => {
    const html = await getBackupCodesRegeneratedEmailHtml({
      changedAt: AT,
      codeCount: 10,
    });

    expect(html).toContain("backup codes were regenerated");
    expect(html).toContain("10");
    expect(html).toContain("stopped working");
  });

  test("username change shows both handles and the alias window", async () => {
    const html = await getUsernameChangedEmailHtml({
      changedAt: AT,
      previousUsername: "zephyr",
      previousUsernameExpiresAt: "17 November 2026",
      username: "parazeeknova",
    });

    expect(html).toContain("@parazeeknova");
    expect(html).toContain("@zephyr");
    expect(html).toContain("17 November 2026");
  });

  test("account merge names the kept and retired handles", async () => {
    const merged = await getAccountMergedEmailHtml({
      completedAt: AT,
      keptUsername: "parazeeknova",
      mode: "merge",
      removedUsername: "old.handle",
    });
    const discarded = await getAccountMergedEmailHtml({
      completedAt: AT,
      keptUsername: "parazeeknova",
      mode: "discard",
      removedUsername: "old.handle",
    });

    expect(merged).toContain("Your accounts were merged");
    expect(merged).toContain("@parazeeknova");
    expect(merged).toContain("@old.handle");
    expect(discarded).toContain("discarded");
  });

  test("every credential notice is on the shared card shell", async () => {
    const notices = await Promise.all([
      getPasskeyChangedEmailHtml({
        action: "added",
        changedAt: AT,
        passkeyName: "Key",
      }),
      getBackupCodesRegeneratedEmailHtml({ changedAt: AT, codeCount: 8 }),
      getUsernameChangedEmailHtml({
        changedAt: AT,
        previousUsername: "before",
        previousUsernameExpiresAt: "later",
        username: "after",
      }),
      getAccountMergedEmailHtml({
        completedAt: AT,
        keptUsername: "a",
        mode: "merge",
        removedUsername: "b",
      }),
    ]);

    for (const html of notices) {
      expect(html).toContain("asm_email_header_transactional.png");
      expect(html).toContain("asm_email_footer.png");
      expect(html).toContain("The asocialmedia team 🫶");
      expect(html).not.toContain("<svg");
      expect(html).toContain("mailto:hello@asocialmedia.cc");
    }
  });
});
