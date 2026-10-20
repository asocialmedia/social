# Elysia 2 and Expo SDK 58

Release documentation checked on October 20, 2026 using the official guides,
Context7, and npm release tags.

## Elysia

The protocols service targets `elysia@2.0.0-rc.0`. Elysia 2 is still a release
candidate; npm's stable `latest` tag remains on 1.4.30.

- [Elysia 2 features and migration guide](https://elysiajs.com/blog/elysia-20)
- [Published Elysia versions](https://www.npmjs.com/package/elysia?activeTab=versions)

Route schemas precede their handlers, and error handlers register error classes.
The published RC retains `onRequest`, `onBeforeHandle`, and `onError`; the blog
shows shorter lifecycle names that this RC does not expose. The service preserves its
existing JSON error responses, HTTP statuses, internal authorization, request IDs,
and retry hints. Its schemas use the new `typebox` package rather than
`@sinclair/typebox`.

Elysia 2 brings schema reuse and compilation caching automatically. Build-time AOT
is optional and is not enabled here: its capture step executes application code,
and the protocols entry point also starts Redis connections and live consumers.

## Expo

The mobile app targets stable Expo SDK 58 with React Native 0.88. Shared UI native
dependencies and root overrides must match the mobile app's SDK versions.
Dependencies use Bun's hoisted linker so Expo and Router share native module
installations. Lightning CSS is pinned at the version required by NativeWind 5's
RC compiler.

- [SDK 58 release notes](https://expo.dev/changelog/sdk-58)
- [SDK 58 API reference](https://docs.expo.dev/versions/v58.0.0/)
- [Router 57 to 58 migration](https://docs.expo.dev/router/migrate/sdk-57-to-58/)
- [SDK upgrade walkthrough](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/)

The root stack uses `activityEnabled={1}` to preserve covered screens while
suspending their effects. `freezeOnBlur` is ineffective in SDK 58. React Compiler
remains enabled. Native module call improvements and prebuilt Android
`expo-modules-core` libraries come from the SDK upgrade automatically.

`File.write()` and file-handle reads are now asynchronous. Multipart uploads await
completed reads and writes;
synchronous draft and crop operations use `writeSync()`. The Android browser
referrer and Reanimated unmounted-view patches are carried to the new versions.

## Validation and native builds

Run `bun run check`, `bun run check-types`, the protocols HTTP tests, and mobile
regressions after changing these versions. From `apps/mobile`, use
`bun expo install --check --bun` and `bunx expo-doctor` for SDK diagnostics, and
`bun expo export --platform android --platform ios` for bundle validation.

SDK upgrades require a new native build. The repository's `bun apk` workflow
regenerates Android through Expo prebuild and provisions the existing release
signing configuration. An APK built with SDK 57 cannot run the SDK 58 native
modules through a JavaScript-only update. Verify navigation, playback, uploads,
camera capture, authentication handoffs, and push notifications on a rebuilt app.
