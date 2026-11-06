import { expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

let user: { id: string } | null = { id: "reader" };
let ready = false;
let error: Error | null = null;
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user }),
}));
mock.module("@/hooks/feed/use-network-settings", () => ({
  useNetworkSettings: () => ({
    error,
    ready,
    refetch: () => Promise.resolve(),
    scope: "scope",
  }),
}));
const { useExternalProfileActivity } =
  await import("./use-external-profile-activity");
function Probe() {
  const query = useExternalProfileActivity("profile", "amplified");
  return (
    <div data-loading={query.loading} data-network-error={query.networkError} />
  );
}
function render() {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  client.clear();
  return html;
}

test("pending settings keep activity loading; failed settings expose retryable failure instead", () => {
  expect(render()).toContain('data-loading="true" data-network-error="false"');
  error = new Error("settings unavailable");
  expect(render()).toContain('data-loading="false" data-network-error="true"');
  error = null;
  ready = true;
  expect(render()).toContain('data-loading="true" data-network-error="false"');
});

test("a disabled guest activity query does not spin forever", () => {
  user = null;
  ready = true;
  expect(render()).toContain('data-loading="false" data-network-error="false"');
});
