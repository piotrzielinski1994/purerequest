# Spec: Timing breakdown (per-send waterfall)

## 1. Overview

Every send already returns a single `timeMs` total. This feature captures the **phase
breakdown** of that total on the Rust side and renders it as a **waterfall** in a new
**Timing** tab of the response pane.

v1 ships **4 phases** (the honest split reqwest can produce without owning the whole
connector):

| Phase          | Meaning                                                              |
| -------------- | ------------------------------------------------------------------- |
| `dns`          | DNS name resolution                                                  |
| `connect`      | TCP connect + TLS handshake (combined - reqwest can't cleanly split) |
| `waiting`      | Time to first byte: request written -> response headers arrive       |
| `download`     | Response body read (headers received -> body fully read)             |

The four segments sum to the total. TCP-vs-TLS split is **explicitly deferred** (it needs
a fully custom connector - raw `TcpStream` + `tokio-rustls` - which is fragile; out of scope).

### Scope

In:
- Rust: capture `dns` / `connect` / `waiting` / `download` durations in `send_http_request`
  and return them in a new optional `timings` field on the response payload.
  - `dns` via a `reqwest::dns::Resolve` wrapper that times the lookup.
  - `connect` (TCP+TLS) via a `reqwest::ClientBuilder::connector_layer` Tower layer that
    times the connect span, minus the measured DNS time.
  - `waiting` = time-to-headers (`send()` resolve) minus the connect span.
  - `download` = duration of `response.text()`.
- New `tower` direct dependency (reqwest already uses it internally; we add it as a direct
  dep to author the connector layer).
- Frontend: an optional `timings` object on `RequestResponse`, a new **Timing** tab, a
  waterfall component (proportional bars + per-phase ms), and an empty state when a response
  carries no timings (seeded/legacy/error responses, dev-browser fake).
- The fake HTTP client (dev browser + tests) returns representative `timings` so the tab is
  demoable without a Tauri host.

Out (deferred):
- TCP vs TLS split (needs a custom connector).
- Persisting timings to disk (`response` is already session-only; timings ride along and are
  never written to `*.req.json`).
- Redirect-per-hop breakdown, retries, connection-reuse attribution beyond "sum of spans".
- Any timing on a cancelled or failed send (no response -> no timings).

### Decisions (recommended defaults, all confirmed with user)

- **4-phase fidelity** (user pick): DNS / Connect(TCP+TLS) / Waiting / Download. 3-phase and
  5-phase rejected (see `## 10`).
- **New "Timing" tab** (user pick), beside Response / Headers. The top-right status strip
  keeps showing only the total `timeMs` (unchanged).
- **`timings` is optional** on `RequestResponse`. Absent = the Timing tab shows an empty
  state ("No timing data for this response."). This keeps seeded/legacy/error responses valid
  with zero migration.
- **Segments are clamped to `>= 0`** and, on the frontend, a residual rounding gap is folded
  into `waiting` so the four bars always sum to the displayed total (no "bars don't add up").
- **DNS is measured inside the connect span**, so `connect` (TCP+TLS) is reported as
  `connectSpan - dns` (clamped `>= 0`) to avoid double-counting DNS.

## 2. Data model

### Wire (Rust -> frontend), camelCase

```ts
// added to RequestResponse (src/lib/workspace/model.ts)
export type ResponseTimings = {
  dnsMs: number;       // DNS resolution
  connectMs: number;   // TCP connect + TLS handshake (combined)
  waitingMs: number;   // TTFB: request sent -> response headers
  downloadMs: number;  // response body read
};

export type RequestResponse = {
  status: number;
  timeMs: number;
  sizeBytes: number;
  body: string;
  headers: KeyValue[];
  timings?: ResponseTimings;   // optional: absent on seeded/legacy/error responses
};
```

Rust mirror (`HttpResponsePayload` gains `timings: Option<ResponseTimings>`, serialized
camelCase; a `ResponseTimings` struct with `dns_ms`/`connect_ms`/`waiting_ms`/`download_ms`).

No zod (workspace layer has none), no disk-format change, no migration - `response` is
session-only state.

## 3. Rust capture mechanism

`send_http_request` builds a fresh `reqwest::Client` per call (existing behavior), so
per-request shared timing state is safe (no cross-request contamination).

- A `TimingProbe` holds `Arc<Mutex<..>>` accumulators (dns nanos, connect nanos). It is
  cloned into (a) a `Resolve` wrapper around the default resolver and (b) the connector
  layer, both installed on the `ClientBuilder`.
- **DNS**: the `Resolve` wrapper records `Instant::now()` before delegating to the inner
  resolver and adds the elapsed to `dns` on completion.
- **Connect (TCP+TLS)**: a Tower `Layer` wraps the base connector `Service`; it records the
  elapsed of each connect call into `connect_span`. Because the connector internally runs
  DNS, `connect_span` includes DNS -> reported `connectMs = connect_span - dns` (clamp `>= 0`).
- **Waiting (TTFB)**: `waitingMs = time_at_send_resolve - connect_span` (clamp `>= 0`), where
  `time_at_send_resolve` is `start.elapsed()` right after `builder.send()` resolves.
- **Download**: measured around `response.text()`.
- On redirects / multiple connects, spans **accumulate** (sum) - documented approximation.
- `time_ms` (total) is unchanged (full `start.elapsed()`), and the four phases are computed
  so `dns + connect + waiting + download == time_to_headers + download == time_ms`
  (within rounding).

If, for any reason, a phase can't be measured (e.g. a connection-reuse path never hits the
connector), its value is `0`; the tab still renders and the residual lands in `waiting`.

## 4. UI

### Timing tab

A third `TabsTrigger` "Timing" beside Response / Headers. Its content is a `TimingWaterfall`
component. It obeys the design contract: tokens only (no hard-coded hex), `font-mono` for
the numbers, 1px dividers, no rounded corners, muted-foreground for labels.

Each row: a fixed-width phase label (muted), a proportional horizontal bar (its width =
phase / total), and a right-aligned `font-mono` ms value. A final divider + a **Total** row.
Bars use a token background (`bg-foreground/70` fill on a `bg-muted/30` track) - single
neutral fill, no per-phase rainbow (matches the app's restrained palette). A zero-width phase
still shows its label + `0ms`.

When `response.timings` is absent, the tab body is a centered muted message
("No timing data for this response.").

### UI States

| State                    | Behavior                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| Success, timings present | Waterfall: 4 proportional bars + ms each, then a Total row          |
| Success, timings absent  | Centered "No timing data for this response." (seed/legacy/fake-off) |
| Sending                  | Pane shows "Sending…" (unchanged; tab content not reachable)        |
| Error                    | Pane shows the error (unchanged; no timings)                        |
| Idle / no request        | "No response" (unchanged)                                           |

### ASCII wireframe (Timing tab, success)

```
+---------------------------------------------------------+
| [ Response ] [ Headers ] [ Timing ]    200  142ms  1.5KB|
+---------------------------------------------------------+
|                                                         |
|  DNS       |####                          |     12ms    |
|  Connect   |############                  |     34ms    |
|  Waiting   |##############################|     88ms    |
|  Download  |###                           |      8ms    |
|  -----------------------------------------------------  |
|  Total                                          142ms   |
|                                                         |
+---------------------------------------------------------+
```

### ASCII wireframe (Timing tab, no timing data)

```
+---------------------------------------------------------+
| [ Response ] [ Headers ] [ Timing ]    200  142ms  1.5KB|
+---------------------------------------------------------+
|                                                         |
|                                                         |
|            No timing data for this response.            |
|                                                         |
|                                                         |
+---------------------------------------------------------+
```

## 5. Acceptance criteria

- AC-001: `send_http_request` returns a `timings` object with `dnsMs`, `connectMs`,
  `waitingMs`, `downloadMs` (all `>= 0`) on a successful send.
- AC-002: The four phase values sum to the response `timeMs` within a small rounding
  tolerance (<= a few ms), i.e. they partition the total, not overlap it.
- AC-003: `connectMs` excludes DNS time (DNS is not double-counted inside connect).
- AC-004: A cancelled or transport-failed send returns no timings (the existing `Err`
  path is unchanged; `timings` only exists on the success payload).
- AC-005: The wire response (de)serializes with `timings` present AND with `timings` absent
  (backward compatible - an older/seeded response with no `timings` still parses).
- AC-006: `RequestResponse.timings` is optional in the frontend type; a response without it
  is valid.
- AC-007: The response pane has a **Timing** tab beside Response and Headers.
- AC-008: With timings present, the Timing tab renders a labelled row per phase (DNS,
  Connect, Waiting, Download) each showing its ms, plus a Total row equal to `timeMs`.
- AC-009: Each phase bar's width is proportional to its share of the total (a larger phase
  renders a wider bar); a zero phase renders a zero-width bar but still shows its label + ms.
- AC-010: With timings absent, the Timing tab shows the "No timing data for this response."
  empty state (no crash, no NaN, no bars).
- AC-011: The fake HTTP client (dev browser + tests) returns representative `timings` so the
  Timing tab is populated without a Tauri host.

## 6. Test cases

Rust (`cargo test`, wiremock):
- TC-001 (happy, AC-001/002): GET a 200 mock -> result has `timings`; `dns+connect+waiting+
  download` is within tolerance of `time_ms`. Maps to: AC-001, AC-002.
- TC-002 (edge, AC-003): with a measured DNS span, `connect_ms` is the connect span minus
  DNS (assert `connect_ms <= connect_span` and no double count) - or, more robustly, assert
  `connect_ms >= 0` and `dns_ms + connect_ms <= time_to_headers`. Maps to: AC-003.
- TC-003 (edge, AC-004): an unreachable host still returns `Err` (no timings surface). Maps
  to: AC-004.
- TC-004 (serde, AC-005): `HttpResponsePayload` with `timings: Some(..)` serializes camelCase
  (`timings.dnsMs` etc.); an incoming/legacy value without `timings` still deserializes into
  the request path unaffected (timings is response-only, so cover response serialize both
  with and without). Maps to: AC-005.

Frontend (`npm test`, Vitest + Testing Library):
- TC-005 (happy, AC-007/008): render the response pane with a success response carrying
  timings -> a "Timing" tab exists; activating it shows DNS/Connect/Waiting/Download rows
  with their ms and a Total row = `timeMs`. Maps to: AC-007, AC-008.
- TC-006 (edge, AC-009): a response where one phase dominates -> that bar's rendered width
  (style width %) is larger than a smaller phase's; a `0ms` phase still renders its row.
  Maps to: AC-009.
- TC-007 (edge, AC-010): a success response with `timings` undefined -> the Timing tab shows
  "No timing data for this response.", no bars, no NaN. Maps to: AC-010, AC-006.
- TC-008 (unit, AC-002/009): the pure waterfall-row builder (percent + clamped residual)
  returns rows that sum to 100% and fold the rounding residual into `waiting`. Maps to:
  AC-002, AC-009.
- TC-009 (integration, AC-011): the fake client's default result includes `timings`, so a
  dev-browser send populates the Timing tab. Maps to: AC-011.

## 7. Edge cases

- **Cancelled / failed send**: no response -> no timings (AC-004). Existing `Err` path
  untouched.
- **Connection reuse / redirects**: connector/resolver may fire 0..n times; spans accumulate
  (sum). A reused connection can report `connect_ms = 0`; the residual folds into `waiting`.
- **Rounding**: nanos -> ms truncation can make the four phases miss `time_ms` by 1-2ms; the
  frontend folds the residual (`timeMs - sum(phases)`, clamped `>= 0`) into the `waiting` bar
  so the total row always matches and bars sum to 100%.
- **Zero total** (mock replies in <1ms): `timeMs` could be 0 -> guard the percent divisor
  (`total || 1`) so no divide-by-zero / NaN; all bars render 0-width.
- **Timings present but a phase negative** (clock skew): clamp each to `>= 0` in Rust.
- **Legacy/seeded response**: has no `timings` -> empty state (AC-010).
- **Large body download**: `download_ms` covers the full `response.text()` even when the body
  is later head-truncated in the viewer (timing is of the transfer, not the render).

## 8. Dependencies

- New Rust dep: `tower` (matching reqwest 0.12's `tower` 0.5) for the connector `Layer` /
  `Service`. No new frontend npm dep.
- Reuses `reqwest` `dns` + `connector_layer` (both already in reqwest 0.12), `formatDuration`,
  the `Tabs` primitives, `ScrollArea`, and the existing response-state plumbing.

## 9. Infrastructure Prerequisites

| Category              | Requirement |
| --------------------- | ----------- |
| Environment variables | N/A         |
| Registry images       | N/A         |
| Cloud quotas          | N/A         |
| Network reachability  | N/A (tests use wiremock loopback) |
| CI status             | N/A         |
| External secrets      | N/A         |
| Database migrations   | N/A (response is session-only, no disk schema) |

Verification before implementation: `cargo add tower` resolves against the locked reqwest
0.12 tree; `cargo test` builds.

## 10. Approaches considered

- **3-phase (DNS / Connect+Wait / Download)** - rejected by user: no new dep, but lumps
  TCP+TLS+server-processing into one bar, too coarse to be useful.
- **4-phase (chosen)** - DNS via custom resolver, Connect(TCP+TLS) via `connector_layer`,
  Waiting derived, Download measured. One new dep (`tower`), moderate Rust, honest split.
- **5-phase (DNS / TCP / TLS / Wait / Download)** - rejected: requires fully owning the
  connector (raw `TcpStream` + `tokio-rustls`, reimplementing hyper's connect), fragile and
  high-effort; deferred.

## 11. Risks

- `connector_layer` API shape / `tower` version drift: mitigate by adding `tower` via
  `cargo add` against the locked tree and building before wiring the waterfall.
- Connection reuse under-attributing connect time: acceptable v1 approximation; residual
  folds into `waiting`, total stays correct.
- Timing skew making a phase negative: clamped `>= 0` in Rust.

## 12. Status - DONE (verified 2026-07-10)

Fresh verifier subagent (no impl context): overall PASS on all 11 ACs + all gates. After
verdict, the AC-003 test (a weak loopback bounds check that couldn't catch a DNS double-count,
since `dns_ms == 0` on a numeric-IP URL) was strengthened: the phase math was extracted into a
pure `ResponseTimings::partition(..)` and a deterministic unit test now pins
`connect_ms == connect_span - dns_ms` with a non-zero DNS span (red-green proven: reverting the
`- dns_ms` subtraction fails it `left: 50, right: 30`). Live-verified in the dev-browser build:
Timing tab shows DNS 12 / Connect 34 / Waiting 88 / Download 8, Total 142ms (exact sum), bars
proportional (Waiting widest), design-contract-clean.

Gates: 16 cargo tests, 1697 frontend tests, tsc clean, lint 0 errors (8 pre-existing
react-refresh warnings), `npm run build` OK. No disk-schema change (response is session-only).

### AC -> test traceability

| AC | Test |
| --- | --- |
| AC-001 | cargo `should_return_timings_that_partition_the_total_if_the_send_succeeds` (timings `Some`, all four fields) |
| AC-002 | cargo same test (`sum <= time_ms` and `>= time_ms - 4`) + vitest `timing.test.ts` "percents sum to 100" + cargo `should_exclude_dns_time_from_connect` (exact partition `20+30+40+8`) |
| AC-003 | cargo `should_exclude_dns_time_from_connect` (pure `partition`, `connect_ms == 30` not 50, red-green proven) + `should_clamp_phases_to_zero_if_a_span_would_underflow` + integration `should_exclude_dns_time_from_connect_if_the_send_succeeds` |
| AC-004 | cargo `should_yield_no_timings_if_the_send_fails_with_an_unreachable_host` (Err path, no payload) |
| AC-005 | cargo `should_serialize_timings_camel_case_when_present_and_omit_the_key_when_absent` (camelCase values + key ABSENT when `None`) |
| AC-006 | vitest `response-pane.test.tsx` "empty state if timings are absent" (undefined timings type-valid + rendered) |
| AC-007 | vitest `response-pane.test.tsx` "per-phase row ... if timings are present" (Timing tab exists) |
| AC-008 | vitest same test (DNS/Connect/Waiting/Download ms rows + Total = `formatDuration(142)`) |
| AC-009 | vitest `response-pane.test.tsx` "wider bar for a dominant phase and still show a zero-ms row" (`barWidthPercent` reads inline width; 0ms Download row renders) |
| AC-010 | vitest `response-pane.test.tsx` "empty state and no NaN if timings are absent" |
| AC-011 | vitest `fake-client.test.ts` "success response with four numeric timing phases" (DEMO_RESPONSE carries timings; dev-browser wiring in `routes/index.tsx`) |
