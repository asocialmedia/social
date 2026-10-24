Subject: AppView capacity guidance and rate-limit increase for asocialmedia.cc

Hi Bluesky team,

I'm building asocialmedia.cc, a social app that recommends public Bluesky posts using users' interests and personas. We also offer a short-video feed.

Our backend runs across two VPS deployments, in Europe and South Asia. We are experiencing slow feed loading and intermittent upstream failures, and would appreciate guidance on appropriate AppView capacity as we grow.

We use shared Redis caching, deduplicated reads, bounded concurrency, retry backoff, and Jetstream ingestion. We use public.api.bsky.app for supported public reads and api.bsky.app for search; the cached public search endpoint returned 403 in our diagnostic probe.

Our October 24 diagnostic sample showed repeated getFeed 502 responses, search 403 responses, and remote request timeouts. The sampled failures did not establish HTTP 429 rate limiting as the primary cause. A signed-in video feed returned four items, then three empty continuation pages, then one item. We are addressing our own buffering and request-isolation issues as well.

Could you advise on:

- The recommended endpoints and architecture for this use case.
- Whether higher AppView limits or approved capacity are available.
- How to distinguish search cursor restrictions, feed-generator failures, and IP-level restrictions in these responses.
- The request rates, egress IPs, response headers, and traces you need to assess our traffic.

I can provide endpoint-level traffic measurements and expected usage. I would also appreciate guidance on making our Jetstream-backed discovery efficient and reliable.

Thanks,
Parazeeknova
https://asocialmedia.cc
