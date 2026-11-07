# Search and crawl operations

Search engines decide whether to index and rank a page. Neither a sitemap nor a Lighthouse score guarantees indexing or a first-place ranking.

## Public URLs

- `/about`, `/privacy`, and `/toc` render their complete text before JavaScript. They have separate canonical URLs and social metadata.
- Native posts, profiles, public communities, hashtags and gusts are listed in the sitemap index at `/sitemap.xml`. Private communities, moderated posts, banned authors and explicit content stay outside public discovery.
- `/network/bluesky?uri=...` renders a guest-safe source post on the server, with its author, source link, unique metadata and structured data. Media-view query variants canonicalize to the post. If the source is missing, restricted or temporarily unavailable, the interactive reader and retained local discussion remain available, with noindex on the incomplete public preview.
- `/sitemaps/bluesky.xml` includes retained, available source posts with public local comments or amplifications. Private bookmarks and visits alone never add a post to this sitemap. Pure mirrors can still be deduplicated against Bluesky by search engines.
- `/watch/[postId]/[mediaId]` is the dedicated native-video watch page, linked from native posts and individual gusts. It has a prominent player, a stable thumbnail, VideoObject markup and a self canonical. `/sitemaps/videos.xml` supplies video sitemap records. Video eligibility still depends on Google's indexing of the watch page and its video requirements.
- Auth, account settings, messaging, community chat and camera pages should remain outside search results. Do not remove their noindex directives to improve an audit score.

## November 2026 findings

Search Console reported sitemap fetch failures with no last-read date, seven forbidden URLs, two server errors, and five videos without watch pages. Current direct HTTP checks returned 200 XML for the sitemap index and its six deployed children. That verifies one access path only; it does not prove Googlebot can fetch them or resolve historical failures.

The live robots response contains Cloudflare-managed directives in addition to the app's robots rules, including blocks for Baiduspider and PetalBot. The available Cloudflare credential did not expose this site's zone, so no edge policy was changed. An app change cannot override an edge-generated block.

## After deployment

1. Check `/sitemap.xml`, each child sitemap, `/robots.txt`, About, a native post, a public Bluesky post and a video watch URL from outside the origin network. Verify 200, the expected content type, no challenge page, the canonical and the intended robots directive.
2. In Search Console, use URL Inspection's live test on these exact deployed URLs. Inspect the rendered HTML and resources. Re-submit the sitemap index after a successful live fetch, and request indexing for About and representative original-content pages. Do not repeatedly submit unchanged sitemaps.
3. Inspect the exact URLs in the 403 and 5xx reports. Check Cloudflare security events and origin logs for real verified crawlers, including IPv4/IPv6 and www-to-apex redirects. Do not whitelist a user-agent string; it is forgeable. Keep private routes protected.
4. Review Cloudflare's managed robots and crawler policies if discovery by the blocked search engines is desired. Retain separate preferences for AI training crawlers.
5. Check the new video sitemap and VideoObject markup with Google's Rich Results Test, then inspect the watch page in the video indexing report after recrawl. A video on a mixed feed is not itself a dedicated watch page.
6. Monitor actual Search Console impressions, indexed canonical URLs, crawl failures and field Core Web Vitals over time. Lab scores fluctuate and are not field data.

## Repeatable audit

Run `bun scripts/testing/audit-seo.ts https://asocialmedia.cc artifacts/seo-audit/report.json` for a bounded read-only production crawl sample.

Run `bun scripts/testing/audit-site.ts http://localhost:3002 artifacts/site-audit --fixtures=.cache/site-audit-fixtures.json` against a production build for mobile and desktop Lighthouse coverage of every page-route definition. Supply real dynamic-route fixtures as a JSON map from route pattern to path. `--http-only` skips Lighthouse; `--routes=/about,/privacy,/toc` selects routes; `--resume` continues completed audits. Coverage records missing fixtures, redirects and failures explicitly.

For authenticated local audits, add `--headers=.cache/site-audit-headers.json --cookies=.cache/site-audit-cookies.json`. Cookies are scoped to localhost; never commit either credential file. A fresh browser runs each audit, and results identify the destination so a login redirect is not mistaken for the requested page. Camera permissions, microphone input, email verification, password reset and invalid invitation codes require separate functional checks; a Lighthouse score does not verify those workflows.

The `INDEXNOW_KEY` integration already notifies participating engines when native posts are published. It requires the matching public key URL to be reachable. It does not notify Google. Configure and verify it through deployment secrets rather than embedding a key in source.
