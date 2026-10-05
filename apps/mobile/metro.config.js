const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// bun's isolated linker keeps one store entry per peer resolution, so a shared
// workspace package ends up with its own physical copy of react-native even when
// both copies are the same version. This app imports `@asm/ui/native/gooey-toast`,
// which pulls react-native, react-native-svg, react-native-reanimated and
// react-native-safe-area-context, so two React Native runtimes land in one bundle.
// The second runtime re-enters the first's NativeModules getter and the app dies
// at startup with "RangeError: Maximum call stack size exceeded". Pinning each of
// them to the copy this app resolves keeps exactly one runtime in the graph.
// Root package.json `overrides` already pins these to the SDK 57 versions, so the
// two sides agree on version; this handles the remaining physical split.
const mobileModules = path.resolve(__dirname, "node_modules");
config.resolver.extraNodeModules = {
  "react-native": `${mobileModules}/react-native`,
  "react-native-reanimated": `${mobileModules}/react-native-reanimated`,
  "react-native-safe-area-context": `${mobileModules}/react-native-safe-area-context`,
  "react-native-svg": `${mobileModules}/react-native-svg`,
};

// `@noble/*` (the messages crypto) ships untranspiled ESM behind explicit subpath
// exports (`@noble/curves/nist.js`). Metro resolves those through package exports,
// which RN 0.79+ enables by default, and Hermes parses the ESM directly, so no
// `transformIgnorePatterns` override is needed. Deliberately NOT widened here: if a
// future noble release ships syntax Hermes cannot parse, the fix is a targeted
// entry rather than a blanket re-transpile of node_modules.

const findExpoRouterRoot = (originModulePath) => {
  const marker = `expo-router${path.sep}build${path.sep}`;
  const index = originModulePath.lastIndexOf(marker);
  if (index === -1) {
    return null;
  }
  return originModulePath.slice(0, index + "expo-router".length);
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    const origin = context.originModulePath;
    if (!origin || !moduleName.startsWith(".")) {
      throw error;
    }
    const packageRoot = findExpoRouterRoot(origin);
    if (!packageRoot) {
      throw error;
    }
    const candidate = path.normalize(
      path.join(path.dirname(origin), moduleName)
    );
    const relativeToBuild = path.relative(
      path.join(packageRoot, "build"),
      candidate
    );
    const parts = relativeToBuild.split(path.sep);
    while (parts[0] === "..") {
      parts.shift();
    }
    const rebased = path.join(packageRoot, ...parts);
    if (fs.existsSync(rebased)) {
      return { filePath: rebased, type: "sourceFile" };
    }
    throw error;
  }
};

module.exports = withNativewind(config, {
  input: "./src/global.css",
});
