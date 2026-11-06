import { expect, test } from "bun:test";

import { nextDevCommand } from "./next-dev";

test("the selected development runtime handles HTTP headers used by Next.js", async () => {
  const [runtime] = nextDevCommand();
  if (!runtime) throw new Error("Missing development runtime");
  const child = Bun.spawn(
    [
      runtime,
      "-e",
      'const http = require("node:http"); const server = http.createServer((request, response) => { const result = request.headers.hasOwnProperty("host"); response.end(String(result)); }); server.listen(0, "127.0.0.1", async () => { const response = await fetch(`http://127.0.0.1:${server.address().port}`); const body = await response.text(); process.stdout.write(body); server.closeAllConnections(); server.close(); });',
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(stdout).toBe("true");
  expect(exitCode).toBe(0);
});
