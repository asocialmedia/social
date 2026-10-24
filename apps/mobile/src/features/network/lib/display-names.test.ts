import { expect, test } from "bun:test";

test("Network locale choices work without Hermes DisplayNames or copying array methods", () => {
  const moduleUrl = new URL("display-names.ts", import.meta.url).href;
  const result = Bun.spawnSync([
    process.execPath,
    "--eval",
    `Reflect.deleteProperty(Intl, "DisplayNames");
     Reflect.deleteProperty(Array.prototype, "toSorted");
     const { networkDisplayNames, networkLocaleChoices } = await import(${JSON.stringify(moduleUrl)});
     const names = networkDisplayNames();
     const language = networkLocaleChoices(names.language, "language").find(entry => entry.code === "en");
     const region = networkLocaleChoices(names.region, "region").find(entry => entry.code === "IN");
     console.log(JSON.stringify([language?.label, region?.label]));`,
  ]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe('["English","India"]');
});
