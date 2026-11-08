# Verify deployed Android app links

After deploying web changes, run this from the repository root:

```sh
bun apps/mobile/scripts/android/verify-app-links.ts
```

Both `asocialmedia.cc` and `www.asocialmedia.cc` must serve `/.well-known/assetlinks.json` directly with status 200 and an `application/json` content type. Android does not follow the canonical-host redirect when verifying a host. Exclude this exact path from any Cloudflare or reverse-proxy rule that redirects `www` to the apex domain.

The script checks the Android package, signing fingerprints, relation, and dynamic About exclusions against the release configuration. It deliberately rejects redirects and HTML fallback pages. The static Android intent filters remain the fallback on Android versions before dynamic App Links support.

On 2026-11-08, the live canonical host did not yet serve this PR's About exclusions, and the `www` association endpoint returned 301. The app proxy already excludes JSON assets from its matcher, so the `www` redirect must be corrected at the edge or reverse proxy before this deployment check can pass.
