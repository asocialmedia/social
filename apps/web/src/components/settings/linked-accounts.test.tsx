import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import LinkedAccounts from "./linked-accounts";

test("a Google-only member can connect Reddit without a password gate", () => {
  const html = renderToStaticMarkup(
    <LinkedAccounts
      accountLinkingReadiness={{
        hasPassword: false,
        hasVerifiedEmail: true,
        linkedProviders: ["google"],
      }}
      onLink={() => {}}
      user={{ email: "member@example.com" }}
    />
  );
  expect(html).toContain("Connect another provider");
  expect(html).toContain("Disconnect");
  expect(html).toContain("Connect");
  expect(html).not.toMatch(/<button[^>]*\sdisabled(?:=|>)/);
  expect(html).not.toContain("add a password before");
});
