// Client-safe community surface.
//
// Client components (the creation wizard, discovery rails, accent resolver)
// need the topic taxonomy, the accent palette, the limits, and the slug rules.
// Importing those from the @asm/db barrel drags its server-only dependencies
// (logger -> OpenTelemetry -> node:async_hooks) into the browser bundle and
// breaks the build, so they are exposed through this dependency-free entry
// instead. Everything here is pure data or pure functions with no imports
// outside this folder.

export * from "./constants";
export * from "./slug";
