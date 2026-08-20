# Tickets: Resilient model catalog startup

Make the model picker load quickly and recover correctly when provider authentication probes are slow or temporarily unavailable.

Work the **frontier**: any ticket whose blockers are all done. Tickets 1 and 2 can start in parallel.

## Make provider authentication detection resilient

**What to build:** Hive keeps a reliable in-memory authentication snapshot for installed agent providers. Slow or malformed probes become an unknown state rather than falsely signing providers out, and model catalog requests use the snapshot without waiting on CLI processes.

**Blocked by:** None — can start immediately.

- [x] Authentication detection distinguishes authenticated, unauthenticated, and unknown outcomes.
- [x] Unknown outcomes preserve the last definitive state; without history, installed providers remain available.
- [x] Authentication snapshots use a 60-second in-memory cache, single-flight refreshes, and a bounded startup warm-up.
- [x] Explicit Hive tool/auth changes invalidate or refresh the snapshot.
- [x] Diagnostics log provider, safe failure category, and duration without CLI output or account data.
- [x] Backend tests cover definitive sign-out, timeout/error/invalid-output handling, caching, concurrency, and catalog filtering.

## Move the web model catalog to React Query

**What to build:** The web client owns remote model-catalog data through the same React Query lifecycle as the rest of Hive, so requests are deduplicated, retried, prefetched at startup, refreshed during resync, and reset correctly when switching servers.

**Blocked by:** None — can start immediately.

- [x] The module-level catalog cache, promise, and listener system are removed.
- [x] Per-composer model selection and locked-provider seeding remain correct across remounts and catalog refreshes.
- [x] The catalog is prefetched when the configured app starts.
- [x] Existing setup/settings flows can explicitly refresh the catalog.
- [x] Frontend tests cover retries, prefetch-compatible caching, refreshes, provider locking, and server lifecycle behavior.

## Add honest composer loading and recovery states

**What to build:** The composer communicates model-catalog loading and failure using Hive's existing compact visual language, while preserving typing and preventing a message from being sent without a valid model.

**Blocked by:** Move the web model catalog to React Query.

- [x] Loading shows a compact muted spinner with `Loading models…`.
- [x] Failure shows a compact muted `Retry models` action that refetches directly.
- [x] The user can keep typing while loading or retrying.
- [x] Sending is disabled until a valid model is selected.
- [x] Loading, error, retry, accessibility, and send-gating behavior are covered by frontend tests.

## Integrate and verify model startup recovery

**What to build:** The combined backend and web changes demonstrably eliminate the cold-start placeholder and prevent a transient Claude probe failure from poisoning the model picker for the application lifetime.

**Blocked by:** Make provider authentication detection resilient; Add honest composer loading and recovery states.

- [x] A cold model-catalog request does not wait on provider CLI probes after backend warm-up.
- [x] A transient Claude timeout keeps Claude selectable and a later definitive sign-out hides it.
- [x] Backend and frontend targeted tests, lint, and typecheck pass.
- [x] The desktop/web UI is checked in the running app for loading, success, and retry states.
- [x] No iOS UI behavior or wire-model contract is changed.
