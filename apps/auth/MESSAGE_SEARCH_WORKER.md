# Dedicated message-search worker

Build `apps/auth/Dockerfile` with the `message-search-worker` target. The default target remains the auth service. The dedicated target runs only live indexing, historical backfill and search counts; notification, content and maintenance workers remain in the general service.

Provide the normal server configuration, with database and Redis URLs reaching the same services as the messaging API. Indexing recovers encryption keys from stored identities. Its credentials therefore require access to identity rows and must remain server-side.

Run one dedicated worker initially. Its defaults reserve two live-index slots, one backfill slot and one count slot. When switching from the combined worker, set `MESSAGE_SEARCH_WORKER_ENABLED=0` on the general service so it stops consuming search queues. `MESSAGE_SEARCH_WORKER_ONLY=1` is already set in the dedicated image and takes precedence over that general-worker switch.

`MESSAGE_SEARCH_BACKFILL_ENABLED=0` and `MESSAGE_SEARCH_COUNT_ENABLED=0` independently pause those queues after a service restart. Live indexing continues. Pending work remains in PostgreSQL and is rediscovered after Redis loss or a queue restart. Do not remove durable outbox rows to clear a Redis backlog.

The container health check invokes `./asm-worker --health-check`. It exits successfully only when this container has a fresh process-owned heartbeat, the owning process still exists, all configured queue connections are ready, and the worker has successfully published its Redis heartbeat. It does not initialize service clients or enqueue work. The heartbeat becomes stale after 30 seconds; the image probes every 10 seconds with a 30-second startup grace period. A replica's Redis heartbeat cannot make another container healthy.

The default heartbeat file is `/tmp/asm-message-search-worker-health.json`. Keep it on a writable, process-local filesystem. If overriding `WORKER_HEALTH_PATH`, do not share it between processes or replicas. Files contain only the service name, process ID and last heartbeat time and are written atomically with owner-only permissions.

SIGINT and SIGTERM stop new maintenance pulses, invalidate local health, and drain active jobs and service resources. Shutdown has a 30-second deadline, configurable with `WORKER_SHUTDOWN_TIMEOUT_MS` from 1 to 120000 milliseconds. Configure the platform's termination grace period longer than this deadline. A timeout exits unsuccessfully so the platform can restart the service; stalled jobs and the durable outbox allow another worker to retry safely.

Maintenance sweeps and heartbeats each allow only one in-flight operation. Redis stalls cannot accumulate overlapping timers. Failed search jobs retain safe error codes in logs and Redis failure details, without source exception text, SQL details, job payloads or plaintext search data. Monitor queue age, indexing lag, retry outcomes and the existing bounded worker metrics alongside container health.

For verification, run the lifecycle and health unit tests, the BullMQ lifecycle integration tests against isolated local queues, and the crypto-backed message-search integration suite. The health tests also compile the worker and verify that its production entry point can probe health with unreachable database and Redis addresses.
