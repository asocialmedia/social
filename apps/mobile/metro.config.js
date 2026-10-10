const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Bun can install multiple physical copies of react-native-css for different
// peers. NativeWind must resolve every CSS import to the copy its Metro plugin
// uses, or it rewrites another copy's internal React Native import to itself.
// extraNodeModules is only a fallback and cannot override those nearby copies.
const mobilePackagePath = path.join(__dirname, "package.json");

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
  if (
    moduleName === "react-native-css" ||
    moduleName.startsWith("react-native-css/")
  ) {
    return context.resolveRequest(
      { ...context, originModulePath: mobilePackagePath },
      moduleName,
      platform
    );
  }
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
