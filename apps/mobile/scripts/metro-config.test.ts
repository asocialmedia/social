import { describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const mobilePackagePath = path.resolve(import.meta.dir, "../package.json");
const mobileRequire = createRequire(mobilePackagePath);
const reactNativePath = realpathSync(mobileRequire.resolve("react-native"));
const cssComponentsPath = realpathSync(
  mobileRequire.resolve("react-native-css/components")
);
const sharedOrigin = path.resolve(
  import.meta.dir,
  "../../../packages/ui/native/gooey-toast.tsx"
);
const otherCssComponentsPath = path.resolve(
  import.meta.dir,
  "../../../node_modules/.bun/react-native-css@other-peers/node_modules/react-native-css/dist/commonjs/components/index.cjs"
);

interface ResolverContext {
  originModulePath: string;
  resolveRequest: typeof resolveRequest;
}

function resolveRequest(
  context: ResolverContext,
  moduleName: string,
  _platform: string
) {
  if (moduleName === "react-native") {
    return { filePath: reactNativePath, type: "sourceFile" };
  }
  if (context.originModulePath !== mobilePackagePath) {
    return { filePath: otherCssComponentsPath, type: "sourceFile" };
  }
  return {
    filePath: realpathSync(mobileRequire.resolve(moduleName)),
    type: "sourceFile",
  };
}

// Keep Metro's app type declarations out of the Node/Bun tooling tsconfig.
const metroConfig: {
  resolver: { resolveRequest: typeof resolveRequest };
} = mobileRequire("./metro.config.js");

function resolveModule(originModulePath: string, moduleName: string) {
  return metroConfig.resolver.resolveRequest(
    { originModulePath, resolveRequest },
    moduleName,
    "android"
  );
}

describe("Metro NativeWind runtime resolution", () => {
  test("shared UI imports use the CSS runtime loaded by the Metro plugin", () => {
    const shim = resolveModule(sharedOrigin, "react-native");
    expect(shim.filePath).toBe(cssComponentsPath);
  });

  test("the CSS shim's React Native import does not resolve back to itself", () => {
    const shim = resolveModule(sharedOrigin, "react-native");
    const nativeRuntime = resolveModule(shim.filePath, "react-native");
    expect(nativeRuntime.filePath).toBe(reactNativePath);
    expect(nativeRuntime.filePath).not.toBe(shim.filePath);
  });

  test("CSS entry points and subpaths share the mobile package resolution", () => {
    for (const moduleName of [
      "react-native-css",
      "react-native-css/native-internal",
      "react-native-css/components/Text",
    ]) {
      expect(resolveModule(sharedOrigin, moduleName).filePath).toBe(
        realpathSync(mobileRequire.resolve(moduleName))
      );
    }
  });
});
