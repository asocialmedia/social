// @asm/notifications
//
// The notification domain, shared by web, native, and the worker:
// - `@asm/notifications/shared` is dependency-free (grouping, copy, routing
//   targets) and safe to import from React Native.
// - `@asm/notifications/server` owns push delivery (web push + direct FCM) and
//   must only be imported by server code.
// - the root re-exports the shared layer, so a client importing the package
//   never accidentally pulls web-push into its bundle.
//
// oxlint-disable-next-line oxc/no-barrel-file -- package entry point
export * from "./shared";
