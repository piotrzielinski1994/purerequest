# Plan: Timing breakdown (per-send waterfall)

Implements `spec.md` in this folder. TDD, red-green-refactor. Rust backend + frontend.

## Approach summary

4-phase capture in `send_http_request`, returned as an optional `timings` object on the
response, rendered as a token-styled waterfall in a new **Timing** tab.

- **DNS**: a `reqwest::dns::Resolve` wrapper (`TimingResolver`) around a `GaiResolver`, adding
  each lookup's elapsed to a shared `Arc<Mutex<Timings>>`.
- **Connect (TCP+TLS)**: a **generic** Tower `Layer`/`Service` (`TimingConnectorLayer`) added
  via `ClientBuilder::connector_layer`, timing each `call()` (the connect future). Generic
  over the inner service, so reqwest's private connector types are never named (mirrors
  reqwest's own `TimeoutLayer` usage example). Reports `connect_ms = connect_span - dns_ms`
  (clamped `>= 0`) to avoid double-counting DNS (DNS runs inside the connector).
- **Waiting (TTFB)**: `time_at_headers - connect_span`, clamped `>= 0`.
- **Download**: elapsed around `response.text()`.

Shared state is per-`send_http_request` call (fresh client per send already), so no
cross-request contamination and no global registry needed.

## Files

### Rust (`src-tauri/`)

- `Cargo.toml`: add `tower = "0.5"` (matches locked `0.5.3`) to `[dependencies]`.
- `src/lib.rs`:
  - New `ResponseTimings` struct (`#[serde(rename_all = "camelCase")]`, fields `dns_ms`,
    `connect_ms`, `waiting_ms`, `download_ms: u64`).
  - `HttpResponsePayload` gains `timings: Option<ResponseTimings>` (`#[serde(skip_serializing_if
    = "Option::is_none")]` so an absent value omits the key).
  - `struct Timings { dns: Duration, connect_span: Duration }` behind `Arc<Mutex<..>>`
    (a `TimingProbe` newtype cloned into resolver + connector).
  - `struct TimingResolver { inner: GaiResolver, probe: TimingProbe }` impl `reqwest::dns::Resolve`
    - times `inner.resolve(name)`, adds to `probe.dns`.
  - `struct TimingConnectorLayer { probe }` + `struct TimingConnector<S> { inner: S, probe }`
    impl `tower::Layer` / `tower::Service<Req>` generic over `S` - times each `call()`,
    adds to `probe.connect_span`.
  - `send_http_request`: build the client with `.dns_resolver(Arc::new(TimingResolver..))`
    and `.connector_layer(TimingConnectorLayer..)`; after `send()` resolves capture
    `to_headers = start.elapsed()`; measure `download` around `response.text()`; compute the
    four phases (clamped), attach `Some(ResponseTimings{..})`.
  - Keep `time_ms` = full `start.elapsed()` (unchanged semantics).

### Frontend (`src/`)

- `src/lib/workspace/model.ts`: add `ResponseTimings` type + optional `timings?` on
  `RequestResponse`.
- `src/lib/http/timing.ts` (new): pure `buildWaterfallRows(timings, totalMs)` ->
  `{ label, ms, percent }[]` + a `Total`; folds the rounding residual into `waiting`, guards
  zero total. Unit-tested in isolation.
- `src/components/workspace/timing-waterfall.tsx` (new): renders rows (label + proportional
  bar + ms) via tokens (`bg-foreground/70` fill on `bg-muted/30` track, `font-mono` ms,
  1px divider, no rounding) + a Total row; empty-state message when no timings.
- `src/components/workspace/response-pane.tsx`: add the **Timing** `TabsTrigger` +
  `TabsContent` rendering `TimingWaterfall`.
- `src/components/workspace/workspace-context.tsx`: `ResponseTab` union gains `"timing"`.
- `src/lib/http/fake-client.ts`: default fake result carries a representative `timings`
  (only when the result is a success) so dev-browser + tests populate the tab.

## Execution order (TDD)

1. **RED (Rust)** - spawn test-writer subagent? No: per pz-implement Phase 3, the RED tests
   are written by a fresh test-writer subagent from the task file. The task file for this repo
   is the feature `spec.md` (no Jira). Point the subagent at `spec.md`'s AC/TC. It writes
   failing `cargo` tests (TC-001..TC-004) + failing Vitest tests (TC-005..TC-009).
2. **GREEN (Rust)** - add `tower`, implement the resolver + connector layer + payload; make
   TC-001..TC-004 pass. Commit `feat: AC-001..005 rust timing capture`.
3. **GREEN (frontend model + pure)** - add types + `buildWaterfallRows`; TC-008 passes.
4. **GREEN (frontend UI)** - Timing tab + waterfall + fake timings; TC-005..TC-007, TC-009
   pass. Commit per AC group.
5. **REFACTOR** - dedupe, tighten types (no `any`, guard fns), keep green.

## Acceptance verification

- `cd src-tauri && cargo test` (TC-001..TC-004, plus existing 10 stay green).
- `npm test` (TC-005..TC-009, full suite stays green).
- `npm run typecheck` + `npm run lint` clean.
- Manual (optional): `npm run dev` browser -> send -> Timing tab shows the fake waterfall;
  full app `npm start` -> real send -> phases sum to the total.
- Fresh verifier subagent (Phase 4) confirms each AC maps to a real, non-tautological test.

## AC -> planned test

| AC | Planned test |
| --- | --- |
| AC-001 | cargo TC-001 (timings present, all `>= 0`) |
| AC-002 | cargo TC-001 (sum within tolerance of `time_ms`) + Vitest TC-008 (rows sum 100%) |
| AC-003 | cargo TC-002 (`connect_ms` excludes DNS) |
| AC-004 | cargo TC-003 (unreachable -> Err, no timings) |
| AC-005 | cargo TC-004 (serde camelCase with/without timings) |
| AC-006 | Vitest TC-007 (undefined timings type-valid + empty state) |
| AC-007 | Vitest TC-005 (Timing tab exists) |
| AC-008 | Vitest TC-005 (per-phase rows + Total = timeMs) |
| AC-009 | Vitest TC-006 (proportional widths; 0ms row renders) |
| AC-010 | Vitest TC-007 (empty state, no NaN) |
| AC-011 | Vitest TC-009 (fake client timings populate the tab) |
```

## Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-10 | Domain-modeling gate: evaluated pz-ddd + pz-archetypes, invoked NEITHER | Pure instrumentation/plumbing - no new domain model, aggregate, boundary, or archetype shape (accounting/inventory/ordering/etc.). Timing is a technical measurement rode along the existing response, not a domain concept. |
| 2026-07-10 | 4-phase fidelity (DNS/Connect/Waiting/Download) | User pick. reqwest can't split TCP vs TLS without owning the connector (fragile); 3-phase too coarse. Confirmed via reqwest 0.12.28 source (connector_layer + dns_resolver present). |
| 2026-07-10 | New "Timing" tab (not hover popover) | User pick. Room for a full waterfall, consistent with existing Response/Headers tab pattern. |
