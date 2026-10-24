# External media assessment capacity

At 10:01 UTC on October 24, the production media worker reported 9,417.65417 neurons reserved or used against a 9,500-neuron daily budget. Each Clef-flash attempt reserves 85 neurons before refunding unused tokens after a valid response, so another assessment could not start. The external safety queue had 600 delayed, 10 waiting and two active jobs. Discovery inventory contained 1,537 posts and 507 videos.

This constrains default-safe Home and Gusts independently of AppView request limits. Unknown media must remain withheld. Additional ingestion replicas cannot resolve exhausted assessment capacity.

The warmup now scans the full 2,000-post, ten-minute retained inventory, prioritizing videos. Its previous 200-post, two-minute scan could omit still-usable candidates. Existing assessment admission, deduplication and safety decisions remain enforced.

Paid capacity is disabled by default. Enabling it requires both a Cloudflare Workers Paid account and explicit deployment configuration:

```env
MEDIA_CLEF_PAID_ENABLED=1
MEDIA_CLEF_DAILY_NEURONS=90000
```

Without the explicit flag, the runtime caps the budget at 10,000 neurons even if a larger number is supplied. Invalid values fall back to 9,000. Paid configuration remains bounded at 1,000,000 neurons per day, with the same atomic reservations across replicas. Production's existing 9,500-neuron limit is unchanged until paid capacity is authorized and configured.

Cloudflare lists $0.011 per 1,000 neurons and a shared free allocation of 10,000 per day. A 90,000-neuron application ceiling represents at most $0.99 per day at that rate before accounting for the free allocation. Workers plan charges, other applications and other providers are separate. This is an application usage ceiling, not an account-wide billing limit or a guarantee that every queued candidate can be assessed. Do not reset usage counters to create capacity.

Verify actual usage, queue age and eligible feed supply after enabling capacity. A budget increase must not automatically release unsafe, expired or unassessed media. Existing stale jobs may be discarded and fresh eligible inventory reassessed.

Sources: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and [Clef-flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/), checked October 24, 2026.
