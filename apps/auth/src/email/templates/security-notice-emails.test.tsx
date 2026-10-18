import { describe, expect, test } from "bun:test";

import {
  getEmailChangedEmailHtml,
  getMessageKeyResetEmailHtml,
  getNewClientLoginEmailHtml,
  getPasswordChangedEmailHtml,
  getTwoFactorChangedEmailHtml,
} from "./security-notice-emails";
import { getSocialAccountEmailHtml } from "./social-account-email";

const AT = "18 October 2026 at 14:32 UTC";

describe("security notice emails", () => {
  test("email change notice names the new address", async () => {
    const html = await getEmailChangedEmailHtml({
      changedAt: AT,
      newEmail: "new.address@example.com",
    });

    expect(html).toContain("Your email address was changed");
    expect(html).toContain("new.address@example.com");
    expect(html).toContain(AT);
    expect(html).toContain("hello@asocialmedia.cc");
  });

  test("password change notice reflects the session revocation", async () => {
    const revoked = await getPasswordChangedEmailHtml({
      changedAt: AT,
      signedOutEverywhere: true,
    });
    const kept = await getPasswordChangedEmailHtml({
      changedAt: AT,
      signedOutEverywhere: false,
    });

    expect(revoked).toContain("Every other session was signed out");
    expect(kept).toContain("If you did not change your password");
    // The security CTA points at the security tab, which is a real route.
    expect(revoked).toContain("/settings?tab=security");
  });

  test("two-factor notice distinguishes each kind of change", async () => {
    const enabled = await getTwoFactorChangedEmailHtml({
      change: "enabled",
      changedAt: AT,
      method: "Authenticator app and email codes",
    });
    const disabled = await getTwoFactorChangedEmailHtml({
      change: "disabled",
      changedAt: AT,
      method: "None",
    });

    expect(enabled).toContain("Two-factor authentication turned on");
    expect(enabled).toContain("Authenticator app and email codes");
    expect(disabled).toContain("Two-factor authentication turned off");
    expect(disabled).toContain("only your password");
  });

  test("new sign-in notice carries the device facts", async () => {
    const html = await getNewClientLoginEmailHtml({
      browser: "Firefox on macOS",
      city: "Bhopal",
      country: "India",
      ipAddress: "203.0.113.42",
      signedInAt: AT,
    });

    expect(html).toContain("New sign-in to your account");
    expect(html).toContain("Firefox on macOS");
    expect(html).toContain("Bhopal, India");
    expect(html).toContain("203.0.113.42");
  });

  test("new sign-in notice degrades when location is unknown", async () => {
    const html = await getNewClientLoginEmailHtml({
      browser: "Unknown browser",
      city: null,
      country: null,
      ipAddress: null,
      signedInAt: AT,
    });

    expect(html).toContain("Unknown");
  });

  test("message key reset explains what is lost and who is unaffected", async () => {
    const html = await getMessageKeyResetEmailHtml({
      nextStep: "Created the next time you open Messages",
      resetAt: AT,
    });

    expect(html).toContain("Your messages key was reset");
    // The trade-off is the point of the email: own history goes, peers are fine.
    expect(html).toContain("cannot be read on this");
    expect(html).toContain("do not need to do anything");
  });

  test("every notice is on the shared card shell", async () => {
    const notices = await Promise.all([
      getEmailChangedEmailHtml({ changedAt: AT, newEmail: "a@b.co" }),
      getPasswordChangedEmailHtml({ changedAt: AT, signedOutEverywhere: true }),
      getTwoFactorChangedEmailHtml({
        change: "method-changed",
        changedAt: AT,
        method: "Email codes",
      }),
      getNewClientLoginEmailHtml({
        browser: "Safari",
        city: null,
        country: null,
        ipAddress: null,
        signedInAt: AT,
      }),
      getMessageKeyResetEmailHtml({ nextStep: "On next open", resetAt: AT }),
    ]);

    for (const html of notices) {
      expect(html).toContain("asm_email_header_transactional.png");
      expect(html).toContain("asm_email_footer.png");
      expect(html).toContain("The asocialmedia team 🫶");
      // No inline SVG: Gmail strips it.
      expect(html).not.toContain("<svg");
      // Support route for "this was not me".
      expect(html).toContain("mailto:hello@asocialmedia.cc");
    }
  });

  test("renders interpolated values as inert text", async () => {
    // React escapes text children, so a hostile value can never become markup.
    // Pre-escaping here would double-encode it and show &amp;lt; to the reader.
    const html = await getEmailChangedEmailHtml({
      changedAt: AT,
      newEmail: '<script>alert("x")</script>',
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("&amp;lt;");
  });
});

describe("social account emails", () => {
  test("linked notice names the provider and the account", async () => {
    const html = await getSocialAccountEmailHtml({
      accountName: "hello@asocialmedia.cc",
      action: "linked",
      changedAt: AT,
      provider: "google",
    });

    expect(html).toContain("Google connected to your account");
    expect(html).toContain("hello@asocialmedia.cc");
    expect(html).toContain("Manage connected accounts");
  });

  test("unlinked notice uses the disconnected wording", async () => {
    const html = await getSocialAccountEmailHtml({
      accountName: "u/parazeeknova",
      action: "unlinked",
      changedAt: AT,
      provider: "reddit",
    });

    expect(html).toContain("Reddit disconnected from your account");
    expect(html).toContain("Disconnected");
    expect(html).toContain("still work");
  });

  test("each provider ships its own real brand mark", async () => {
    const expected = {
      bluesky: "email/bluesky.png",
      google: "email/google.png",
      reddit: "email/reddit.png",
    } as const;

    await Promise.all(
      Object.entries(expected).map(async ([provider, path]) => {
        const html = await getSocialAccountEmailHtml({
          accountName: "acct",
          action: "linked",
          changedAt: AT,
          provider: provider as keyof typeof expected,
        });

        expect(html).toContain(path);
        // The mark is the bare logo, not a logo inside a coloured tile.
        expect(html).not.toContain("<svg");
      })
    );
  });

  test("social notice is on the shared card shell", async () => {
    const html = await getSocialAccountEmailHtml({
      accountName: "@zeph.bsky.social",
      action: "linked",
      changedAt: AT,
      provider: "bluesky",
    });

    expect(html).toContain("asm_email_header_transactional.png");
    expect(html).toContain("asm_email_footer.png");
    expect(html).toContain("The asocialmedia team 🫶");
    expect(html).toContain("mailto:hello@asocialmedia.cc");
    expect(html).toContain("/settings?tab=account");
  });
});
