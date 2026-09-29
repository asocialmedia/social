import { NextResponse } from "next/server";

// The supported-build floor for native clients.
//
// A released APK or App Bundle does not update itself: a sideloaded install,
// a Play Store install the user has not updated, or a device that has been off
// Wi-Fi for a month all keep running the build they have. When a release makes
// an older build incompatible with the server, those installations have to be
// told, and the app needs somewhere to read that from.
//
// This is deliberately a floor, not "the latest version". A floor is the only
// value that can retire a build: a client one version behind the newest is
// perfectly supported, so bumping the floor is a deliberate act taken when a
// release actually breaks older builds.
//
// The in-app updater that used to do this downloaded the APK and launched the
// system installer, which is exactly what Play Store policy forbids (it also
// needed the REQUEST_INSTALL_PACKAGES permission). So the client only ever
// learns THAT it is out of support, and hands the user to whatever store or
// release page they installed from. Nothing is fetched or installed here.
//
// Unset floor = every build is supported, which is the right default for a fresh
// deployment and for local development: a stale environment variable must never
// lock real people out of the app.

const MIN_SUPPORTED_VERSION = process.env.MOBILE_MIN_SUPPORTED_VERSION?.trim();

// Where an out-of-support build should send the user. Left to the client, which
// knows whether it came from a store or a sideloaded download.
export function GET(): Response {
  return NextResponse.json(
    {
      latest: process.env.npm_package_version?.trim() || null,
      minimumSupported: MIN_SUPPORTED_VERSION || null,
    },
    {
      headers: {
        // A build floor changes when a release ships, not every second, but a
        // stale cached answer would keep a retired build running for as long as
        // the cache lived - so this must be revalidated every time.
        "cache-control": "no-store",
      },
    }
  );
}
