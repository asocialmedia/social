import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Match Podman's default lookup and preserve any existing host/user policy.
export async function ensureContainerPolicy({
  configHome = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
  systemPolicy = "/etc/containers/policy.json",
}: { configHome?: string; systemPolicy?: string } = {}) {
  const userPolicy = path.join(configHome, "containers", "policy.json");
  for (const candidate of [userPolicy, systemPolicy]) {
    try {
      await access(candidate);
      return null;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }
  await mkdir(path.dirname(userPolicy), { recursive: true });
  // Dev images are unsigned. Permit only the registries used by this stack;
  // leave all other transports and registries rejected.
  const policy = {
    default: [{ type: "reject" }],
    transports: {
      docker: {
        "docker.io": [{ type: "insecureAcceptAnything" }],
        "public.ecr.aws": [{ type: "insecureAcceptAnything" }],
      },
      "containers-storage": { "": [{ type: "insecureAcceptAnything" }] },
    },
  };
  try {
    await writeFile(userPolicy, `${JSON.stringify(policy, null, 2)}\n`, {
      flag: "wx",
    });
    return userPolicy;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return null;
    }
    throw error;
  }
}
