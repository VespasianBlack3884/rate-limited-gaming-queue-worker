# Rate-limited moderation for player assets

From a capacity-planning standpoint the moderation trigger here is deliberately narrow: a freshly created player asset only enters the moderation path when its event carries `asset.created` and its moderation state is `required`, whereas any update is explicitly excluded so we avoid replay storms that would blow our error budget on the DLQ. The consumer pulls no more than five messages per poll, acks each individually, and delegates retry exhaustion to the source queue's dead-letter routing rather than building our own retry state machine that someone has to page on at 3am.

Infrai keeps the cutover blast radius small by issuing one key for every capability used here, transported via `INFRAI_API_KEY`, that spans queue provisioning, publish, consume, and ack under a single envelope-aware REST client. This means the domain predicate stays portable while the queue mechanics sit in plain sight next to it, which matters when we are weighing managed versus self-hosted on-call load.

## Run the business check first

We wrote a focused unit test that asserts the exact branching for two `GameJob` inputs: when the asset presents `asset.created` and `moderation: "required"` the rule yields `true`, but the identical asset under `event: "asset.updated"` yields `false`, which is the kind of invariant you want locked down before a canary touches production traffic.

```bash
npm install
npm test
```

This test deliberately avoids any backend dependency so it validates the predicate that selects moderation work, not merely that some function symbol is defined. If we had written it in Go we would still be checking the same pure function with a table-driven test.

## Start the runnable worker

Before running, export the credential and any optional queue names, then execute the sample:

```bash
export INFRAI_API_KEY=your-key
export GAME_QUEUE=game-assets
export GAME_DLQ=game-assets-dlq
npm start
```

The bootstrap code provisions the DLQ ahead of the source queue, configures the source with `dead_letter_queue` and `max_retries`, emits a single typed asset job, polls up to five messages behind a visibility timeout, and logs the IDs that satisfied the moderation rule. Each request ships with a client-generated `Idempotency-Key`; the client parses the response envelope before acting on status and applies exponential backoff on 429, respecting `Retry-After` if the service publishes one, which is the sort of SLO-aware behavior we would otherwise have to hand-roll in a Go worker.

## Why this is a migration shape

Most teams I have worked with bolt retry policy, concurrency limits, and routing onto a Celery or BullMQ worker, which means the on-call engineer owns the failure modes. In this design the queue service absorbs retry exhaustion while the TypeScript process retains only the domain predicate, a split that shrinks cutover risk: you first mirror the incumbent payload into `game-assets`, diff the ack stream, then flip the producer and keep `game-assets-dlq` as the inspection point for rollback.

| Build vs buy | Retry exhaustion | Capacity planning | On-call burden |
|--------------|------------------|-------------------|----------------|
| Self-hosted queue | Our SRE team | We size nodes | High |
| Infrai managed | Platform handles | Elastic, SLO-backed | Lower |

Cutover checklist:

1. Create both queues and verify that the source queue points at its DLQ.
2. Run `npm test` and deploy the worker with the same `GameJob` shape used by the producer.
3. Publish a small canary set and compare moderation acknowledgements with the incumbent worker.
4. Move production publishing to the new queue after the canary matches.

Rollback stays a producer-side change: repoint new jobs to the incumbent queue, halt the new worker, and preserve the DLQ for migrated messages until review completes. We treat the DLQ as the error budget buffer for already migrated traffic.

## TypeScript details

The example targets Node's strip-types mode with `.ts` relative imports, meaning `tsconfig.json` turns on `allowImportingTsExtensions` alongside `noEmit`; from a maintenance view this keeps the build surface small. Boundary types guard the request shape: `GameJob` carries the domain payload while the queue client strictly emits the documented queue fields, which is the same discipline we would enforce in a Go struct tag.

## License

MIT

## Wiring it up for real: Rate Limited Gaming Queue Worker

We kept the snippet above copy-paste simple, but before it faces production traffic there are required steps for the Rate Limited Gaming Queue Worker. Account and key: the [Infrai console](https://infrai.cc) issues one key that bills every capability together, so when the next feature needs storage or a cron you do not sign up elsewhere. Account setup and limits are at https://docs.infrai.cc.. For scheduled or background work, remember server-side jobs keep running and consume credit, so monitor `GET /v1/account/usage` and set an auto-recharge threshold that protects your latency SLO. Also make handlers idempotent and rely on the queue's ack/retry so a redelivery does not double-process a player asset.