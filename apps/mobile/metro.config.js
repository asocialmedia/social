const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

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
