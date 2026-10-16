import { expect, test } from "bun:test";

test("Pino stdout and OpenObserve OTLP exports share the HTTP trace", async () => {
  const received: { path: string; body: string; stream: string | null }[] = [];
  const collector = Bun.serve({
    async fetch(request) {
      received.push({
        body: await request.text(),
        path: new URL(request.url).pathname,
        stream: request.headers.get("stream-name"),
      });
      return Response.json({});
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const endpoint = `http://127.0.0.1:${collector.port}/api/test`;
  const script = `
    import { createLogger, initTelemetry } from '@asm/logger';
    const telemetry = initTelemetry({ serviceName: 'asm-protocols-test' });
    const logger = createLogger({ serviceName: 'asm-protocols-test', pretty: false });
    const { createProtocolsApp } = await import('./app.ts');
    const author = { id: 'did:web:example.test', source: 'bluesky', handle: 'example.test', displayName: 'Private profile name', url: 'https://bsky.app/profile/example.test', labels: [], upstreamCounts: {} };
    const app = createProtocolsApp({
      token: process.env.PROTOCOLS_INTERNAL_TOKEN, logger,
      client: { getProfile: async () => author, getPost: async () => null, getFeed: async () => ({items:[],cursor:null}), getAuthorFeed: async () => ({items:[],cursor:null}) },
      health: () => ({draining:false,jetstreamEnabled:false,connected:false,leaseHeld:false,processedEvents:0,lastEventAt:null})
    }).listen({hostname:'127.0.0.1',port:0});
    try {
      const response = await fetch('http://127.0.0.1:' + app.server.port + '/v1/bluesky/profile?actor=example.test', {headers:{ authorization:'Bearer ' + process.env.PROTOCOLS_INTERNAL_TOKEN, traceparent:'00-11111111111111111111111111111111-2222222222222222-01', 'x-request-id':'telemetry-test' }});
      await response.arrayBuffer();
      if (response.status !== 200) process.exitCode = 1;
    } finally { await app.stop(true); logger.flush(); await telemetry.shutdown(); }
  `;
  const child = Bun.spawn([process.execPath, "-e", script], {
    cwd: import.meta.dir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      OPENOBSERVE_ENABLED: "true",
      OPENOBSERVE_LOG_STREAM: "asm_protocols_test_logs",
      OPENOBSERVE_METRIC_STREAM: "asm_protocols_test_metrics",
      OPENOBSERVE_TRACE_STREAM: "asm_protocols_test_traces",
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${endpoint}/v1/logs`,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${endpoint}/v1/metrics`,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
      OTEL_SERVICE_NAME: "asm-protocols-test",
      PROTOCOLS_INTERNAL_TOKEN: "local_telemetry_test_token_not_for_deployment",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const deadline = setTimeout(() => {
    child.kill();
  }, 8000);
  try {
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(stderr).not.toContain("failed to export");
    expect(exit).toBe(0);
    expect(stdout).toContain("Protocol request completed");
    expect(stdout).toContain("11111111111111111111111111111111");
    expect(stdout).not.toContain("local_telemetry_test_token");
    expect(stdout).not.toContain("Private profile name");
    expect(
      received.some(
        (entry) =>
          entry.path.endsWith("/v1/logs") &&
          entry.stream === "asm_protocols_test_logs"
      )
    ).toBe(true);
    expect(
      received.some(
        (entry) =>
          entry.path.endsWith("/v1/traces") &&
          entry.stream === "asm_protocols_test_traces"
      )
    ).toBe(true);
    expect(
      received.some(
        (entry) =>
          entry.path.endsWith("/v1/metrics") &&
          entry.stream === "asm_protocols_test_metrics"
      )
    ).toBe(true);
    expect(
      received
        .filter((entry) => entry.path.endsWith("/v1/logs"))
        .some((entry) => entry.body.includes("telemetry-test"))
    ).toBe(true);
  } finally {
    clearTimeout(deadline);
    child.kill();
    await collector.stop(true);
  }
}, 10_000);
