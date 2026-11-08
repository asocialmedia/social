import { mkdir } from "node:fs/promises";
import path from "node:path";

import { launch } from "chrome-launcher";
import lighthouse, { desktopConfig } from "lighthouse";
import { connect } from "puppeteer-core";

import { inspectSeoHtml } from "./audit-seo";
import { auditCountryHeaders, parseAuditCountry } from "./site-audit-headers";
import { routeAuditComplete, withAuditDeadline } from "./site-audit-progress";
import { siteRouteInventory } from "./site-route-inventory";

const root = path.resolve(import.meta.dir, "../..");
const { origin } = new URL(process.argv[2] ?? "http://localhost:3002");
const output = path.resolve(root, process.argv[3] ?? "artifacts/site-audit");
const fixtureFile = process.argv
  .find((arg) => arg.startsWith("--fixtures="))
  ?.slice(11);
const headerFile = process.argv
  .find((arg) => arg.startsWith("--headers="))
  ?.slice(10);
const cookieFile = process.argv
  .find((arg) => arg.startsWith("--cookies="))
  ?.slice(10);
const selectedRoutes = process.argv
  .find((arg) => arg.startsWith("--routes="))
  ?.slice(9)
  .split(",");
const httpOnly = process.argv.includes("--http-only");
const requestCountry = parseAuditCountry(
  process.argv.find((arg) => arg.startsWith("--country="))?.slice(10)
);
const fixtures: Record<string, string> = fixtureFile
  ? await Bun.file(fixtureFile).json()
  : {};
if (
  (headerFile || cookieFile || requestCountry) &&
  !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
) {
  throw new Error(
    "Audit credentials and country simulation are restricted to localhost"
  );
}
if (headerFile && !cookieFile && !httpOnly) {
  throw new Error(
    "Authenticated Lighthouse runs require origin-scoped cookies"
  );
}
const cookies: { name: string; value: string }[] = cookieFile
  ? await Bun.file(cookieFile).json()
  : [];
const suppliedHeaders: Record<string, string> = headerFile
  ? await Bun.file(headerFile).json()
  : {};
const headers = auditCountryHeaders(
  origin,
  origin,
  suppliedHeaders,
  requestCountry
);
const inventory = await siteRouteInventory(root, fixtures);
await mkdir(output, { recursive: true });
const resume = process.argv.includes("--resume");
const savedCoverage = path.join(output, "coverage.json");
const previous: { results?: Record<string, unknown>[] } =
  resume && (await Bun.file(savedCoverage).exists())
    ? await Bun.file(savedCoverage).json()
    : {};
const results: Record<string, unknown>[] = (previous.results ?? []).filter(
  (result) => result.state !== "error" && result.state !== "lighthouse-error"
);
const save = () =>
  Bun.write(
    path.join(output, "coverage.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        inventory,
        note: "Every source page is inventoried. Dynamic routes require explicit fixtures. Redirects and error pages are reported, never counted as successful content audits. Lighthouse is lab data, not field Core Web Vitals.",
        origin,
        requestCountry: requestCountry ?? null,
        results,
      },
      null,
      2
    )
  );
await save();
for (const [index, entry] of inventory.entries()) {
  if (!entry.path) {
    continue;
  }
  if (selectedRoutes && !selectedRoutes.includes(entry.route)) {
    continue;
  }
  if (resume && routeAuditComplete(results, entry.route)) {
    continue;
  }
  const url = new URL(entry.path, origin);
  if (url.origin !== origin) {
    throw new Error("Cross-origin audit fixture rejected");
  }
  let activeFormFactor: "mobile" | "desktop" | undefined;
  try {
    // oxlint-disable-next-line no-await-in-loop -- keep crawler and browser load sequential.
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(60_000),
    });
    // oxlint-disable-next-line no-await-in-loop -- inspect the completed response before starting Lighthouse.
    const html = await response.text();
    const http = {
      bytes: Buffer.byteLength(html),
      finalUrl: response.url,
      redirected: response.redirected,
      status: response.status,
      ...inspectSeoHtml(html),
    };
    if (httpOnly || !response.ok || response.redirected) {
      let state = response.ok ? "http-checked" : "http-error";
      if (response.redirected) {
        state = "redirect";
      }
      results.push({
        http,
        path: entry.path,
        route: entry.route,
        state,
      });
    } else {
      for (const formFactor of ["mobile", "desktop"] as const) {
        activeFormFactor = formFactor;
        if (
          resume &&
          results.some(
            (result) =>
              result.route === entry.route && result.formFactor === formFactor
          )
        ) {
          continue;
        }
        const reportFile = path.join(
          output,
          `${String(index).padStart(2, "0")}-${formFactor}.json`
        );
        // oxlint-disable-next-line no-await-in-loop -- fresh browser per run keeps asset caches cold.
        const chrome = await launch({
          chromeFlags: ["--headless", "--no-sandbox"],
        });
        // oxlint-disable-next-line no-await-in-loop -- connect to this audit's isolated browser.
        const browser = await connect({
          browserURL: `http://localhost:${chrome.port}`,
        });
        try {
          // Cookies are restricted to the audit origin, never sent as global request headers.
          // oxlint-disable-next-line no-await-in-loop -- authentication precedes navigation.
          await browser.setCookie(
            ...cookies.map((cookie) => ({
              ...cookie,
              domain: url.hostname,
              httpOnly: true,
              path: "/",
              secure: url.protocol === "https:",
            }))
          );
          // oxlint-disable-next-line no-await-in-loop -- one page per audit.
          const page = await browser.newPage();
          if (requestCountry) {
            // oxlint-disable-next-line no-await-in-loop -- configure this isolated measurement before navigation.
            await page.setRequestInterception(true);
            page.on("request", async (request) => {
              if (request.isInterceptResolutionHandled()) {
                return;
              }
              try {
                await request.continue({
                  headers: auditCountryHeaders(
                    request.url(),
                    origin,
                    request.headers(),
                    requestCountry
                  ),
                });
              } catch {
                // Closing the owned browser cancels outstanding intercepted requests.
              }
            });
          }
          // oxlint-disable-next-line no-await-in-loop -- activate this audit's tab before collecting paint timings.
          await page.bringToFront();
          console.log(`${entry.route} ${formFactor}: measuring`);
          // oxlint-disable-next-line no-await-in-loop -- one Lighthouse run at a time.
          const result = await withAuditDeadline(
            lighthouse(
              url.href,
              {
                disableStorageReset: cookies.length > 0,
                logLevel:
                  process.env.ASM_AUDIT_VERBOSE === "1" ? "info" : "error",
                onlyCategories: [
                  "performance",
                  "accessibility",
                  "best-practices",
                  "seo",
                  "agentic-browsing",
                ],
              },
              formFactor === "desktop" ? desktopConfig : undefined,
              page
            )
          );
          const report = result?.lhr;
          if (report) {
            // oxlint-disable-next-line no-await-in-loop -- save the completed audit before cleanup.
            await Bun.write(reportFile, JSON.stringify(report));
          }
          const finalUrl = report?.finalDisplayedUrl;
          const redirected = finalUrl
            ? new URL(finalUrl).pathname !== url.pathname
            : false;
          let reportState = "audited";
          if (!report || report.runtimeError) {
            reportState = "lighthouse-error";
          } else if (redirected) {
            reportState = "redirect";
          }
          results.push({
            error: report?.runtimeError,
            finalUrl,
            formFactor,
            http,
            metrics: report
              ? Object.fromEntries(
                  [
                    "first-contentful-paint",
                    "largest-contentful-paint",
                    "total-blocking-time",
                    "cumulative-layout-shift",
                    "speed-index",
                    "total-byte-weight",
                  ].map((name) => [name, report.audits[name]?.numericValue])
                )
              : null,
            path: entry.path,
            report: path.basename(reportFile),
            route: entry.route,
            scores: report
              ? Object.fromEntries(
                  Object.entries(report.categories).map(([name, category]) => [
                    name,
                    category.score,
                  ])
                )
              : null,
            state: reportState,
          });
          // Persist results before browser shutdown, which can be interrupted on Windows.
          // oxlint-disable-next-line no-await-in-loop -- retain each finished report immediately.
          await save();
        } finally {
          try {
            // oxlint-disable-next-line no-await-in-loop -- detach only this audit's browser connection.
            await browser.disconnect();
          } finally {
            // oxlint-disable-next-line no-await-in-loop -- release this audit's Chrome process even if disconnect fails.
            await chrome.kill();
          }
        }
        console.log(`${entry.route} ${formFactor}: ${results.at(-1)?.state}`);
        // oxlint-disable-next-line no-await-in-loop -- preserve partial coverage if a later audit is interrupted.
        await save();
      }
    }
  } catch (error) {
    results.push({
      error: error instanceof Error ? error.message : String(error),
      formFactor: activeFormFactor,
      path: entry.path,
      route: entry.route,
      state: "error",
    });
  }
  // oxlint-disable-next-line no-await-in-loop -- persist after every route.
  await save();
}
console.log(
  `Saved coverage for ${inventory.length} route definitions to ${output}`
);
if (
  results.some((result) =>
    ["error", "lighthouse-error", "http-error"].includes(String(result.state))
  )
) {
  process.exitCode = 1;
}
