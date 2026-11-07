import { mkdir } from "node:fs/promises";
import path from "node:path";

import { launch } from "chrome-launcher";
import lighthouse, { desktopConfig } from "lighthouse";
import puppeteer from "puppeteer-core";

import { inspectSeoHtml } from "./audit-seo";
import { routeAuditComplete } from "./site-audit-progress";
import { siteRouteInventory } from "./site-route-inventory";

const root = path.resolve(import.meta.dir, "../..");
const origin = new URL(process.argv[2] ?? "http://localhost:3002").origin;
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
const fixtures: Record<string, string> = fixtureFile
  ? await Bun.file(fixtureFile).json()
  : {};
if (
  (headerFile || cookieFile) &&
  !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
) {
  throw new Error("Audit credentials are restricted to localhost");
}
if (headerFile && !cookieFile && !httpOnly) {
  throw new Error(
    "Authenticated Lighthouse runs require origin-scoped cookies"
  );
}
const cookies: { name: string; value: string }[] = cookieFile
  ? await Bun.file(cookieFile).json()
  : [];
const headers: Record<string, string> = headerFile
  ? await Bun.file(headerFile).json()
  : {};
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
        origin,
        checkedAt: new Date().toISOString(),
        note: "Every source page is inventoried. Dynamic routes require explicit fixtures. Redirects and error pages are reported, never counted as successful content audits. Lighthouse is lab data, not field Core Web Vitals.",
        inventory,
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
  try {
    // oxlint-disable-next-line no-await-in-loop -- keep crawler and browser load sequential.
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(60_000),
    });
    // oxlint-disable-next-line no-await-in-loop -- inspect the completed response before starting Lighthouse.
    const html = await response.text();
    const http = {
      status: response.status,
      finalUrl: response.url,
      redirected: response.redirected,
      bytes: Buffer.byteLength(html),
      ...inspectSeoHtml(html),
    };
    if (httpOnly || !response.ok || response.redirected) {
      results.push({
        route: entry.route,
        path: entry.path,
        http,
        state: response.redirected
          ? "redirect"
          : response.ok
            ? "http-checked"
            : "http-error",
      });
    } else {
      for (const formFactor of ["mobile", "desktop"] as const) {
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
        const browser = await puppeteer.connect({
          browserURL: `http://localhost:${chrome.port}`,
        });
        try {
          // Cookies are restricted to the audit origin, never sent as global request headers.
          // oxlint-disable-next-line no-await-in-loop -- authentication precedes navigation.
          await browser.setCookie(
            ...cookies.map((cookie) => ({
              ...cookie,
              domain: url.hostname,
              path: "/",
              httpOnly: true,
              secure: url.protocol === "https:",
            }))
          );
          // oxlint-disable-next-line no-await-in-loop -- one page per audit.
          const page = await browser.newPage();
          // oxlint-disable-next-line no-await-in-loop -- activate this audit's tab before collecting paint timings.
          await page.bringToFront();
          // oxlint-disable-next-line no-await-in-loop -- one Lighthouse run at a time.
          const result = await lighthouse(
            url.href,
            {
              disableStorageReset: cookies.length > 0,
              onlyCategories: [
                "performance",
                "accessibility",
                "best-practices",
                "seo",
              ],
              logLevel: "error",
            },
            formFactor === "desktop" ? desktopConfig : undefined,
            page
          );
          const report = result?.lhr;
          // oxlint-disable-next-line no-await-in-loop -- save the completed audit before cleanup.
          if (report) {
            await Bun.write(reportFile, JSON.stringify(report));
          }
          const finalUrl = report?.finalDisplayedUrl;
          const redirected = finalUrl
            ? new URL(finalUrl).pathname !== url.pathname
            : false;
          results.push({
            route: entry.route,
            path: entry.path,
            formFactor,
            http,
            finalUrl,
            state:
              !report || report.runtimeError
                ? "lighthouse-error"
                : redirected
                  ? "redirect"
                  : "audited",
            error: report?.runtimeError,
            scores: report
              ? Object.fromEntries(
                  Object.entries(report.categories).map(([name, category]) => [
                    name,
                    category.score,
                  ])
                )
              : null,
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
            report: path.basename(reportFile),
          });
          // Persist results before browser shutdown, which can be interrupted on Windows.
          // oxlint-disable-next-line no-await-in-loop -- retain each finished report immediately.
          await save();
        } finally {
          // oxlint-disable-next-line no-await-in-loop -- close only this audit's browser.
          await browser.close();
          // oxlint-disable-next-line no-await-in-loop -- release this audit's Chrome process.
          await chrome.kill();
        }
        console.log(`${entry.route} ${formFactor}: ${results.at(-1)?.state}`);
        // oxlint-disable-next-line no-await-in-loop -- preserve partial coverage if a later audit is interrupted.
        await save();
      }
    }
  } catch (error) {
    results.push({
      route: entry.route,
      path: entry.path,
      state: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  // oxlint-disable-next-line no-await-in-loop -- persist after every route.
  await save();
}
console.log(
  `Saved coverage for ${inventory.length} route definitions to ${output}`
);
