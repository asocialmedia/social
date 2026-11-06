const serviceDirectory = process.env.ASM_DEV_SERVICE_CWD;
if (!serviceDirectory) throw new Error("Missing service working directory");
// Bun establishes the workspace watch root before restoring the app's runtime cwd.
process.chdir(serviceDirectory);
delete process.env.ASM_DEV_SERVICE_CWD;
