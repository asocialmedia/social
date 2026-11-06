import path from "node:path";

export async function bashCommand(): Promise<string> {
  if (process.platform === "win32") {
    const gitExecutable = Bun.which("git");
    if (gitExecutable) {
      const candidate = path.resolve(
        path.dirname(gitExecutable),
        "../bin/bash.exe"
      );
      if (await Bun.file(candidate).exists()) return candidate;
    }
  }
  return "bash";
}
