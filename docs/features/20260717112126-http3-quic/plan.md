# Plan - HTTP/3 (QUIC) support + full QUIC dissection

Approach per spec: two subsystems. Transport = a new hand-rolled `quic_client.rs`
(quinn + h3 + h3-quinn, custom tapping `AsyncUdpSocket` + custom `KeyLog`),
selected when a request's `httpVersion == "h3"`. Dissection = a new
`quic_dissect.rs` that decrypts+decodes the tapped datagrams into the existing
`Dissection` model. `dissect.rs` stays the TCP/TLS decoder. TDD throughout.

**Coverage threshold:** none enforced (checked `vitest.config.ts` - no `thresholds`;
`cargo` has none). Verifier still runs the full suites.

**Risk-first ordering:** the QUIC crypto (Task 4) is gated by the RFC 9001
Appendix-A offline test vector BEFORE any live decrypt path (Task 6) is built. If
the crypto can't reproduce the published vector, the dissection subsystem stops
there without wasting the live-capture work.

## Infrastructure prerequisites

| Category | Requirement |
| --- | --- |
| Environment variables | none new (`PUREREQUEST_PCAP` optional, already exists; `PUREREQUEST_TAP_CLIENT` untouched) |
| Registry images | N/A |
| Cloud quotas | N/A |
| Network reachability | tests use a **loopback** QUIC/h3 server (bind `127.0.0.1:0`); no external egress. Optional `--ignored` real-endpoint test hits a public h3 site (parity with the existing `--ignored real_https` tap test) |
| CI status | N/A (local build) |
| External secrets | N/A |
| Database migrations | N/A (the `schemaVersion 5→6` is an in-app on-load migration, not infra) |

Verification: `cd src-tauri && cargo test` + `npm test` run fully offline against
the loopback server + the offline RFC vector.

## File structure map

Create (Rust, `src-tauri/src/`):
- `quic_client.rs` - `send_via_quic(request, token) -> Result<(HttpResponsePayload, QuicCapture), String>`; `TapUdpSocket` (tapping `AsyncUdpSocket`); `KeyLogCapture` (rustls `KeyLog`); `QuicCapture` struct; loopback h3 test server + tests.
- `quic_crypto.rs` - RFC 9001 crypto: `initial_secrets`, `hkdf_expand_label`, `HeaderProtection`, `PacketKeys::open`. Pure fns + the Appendix-A vector test.
- `quic_dissect.rs` - `dissect_quic(capture: &QuicCapture, packets: &PacketCapture) -> Option<Dissection>`; QUIC packet parse, decrypt (via `quic_crypto`), CRYPTO→TLS reassembly, STREAM→HTTP/3, QPACK decode; tests.
- `qpack.rs` - `decode_qpack(encoded: &[u8]) -> Vec<(String,String)>` (static table + literals + dynamic when present), mirroring `hpack.rs`.

Modify (Rust):
- `lib.rs` - add `httpVersion: String` to `HttpRequestPayload` (`#[serde(default)]` → `"auto"`); route in `send_http_request`: `payload.http_version == "h3"` → `send_via_quic` + `quic_dissect::dissect_quic`; else unchanged. `mod quic_client; mod quic_crypto; mod quic_dissect; mod qpack;`.
- `Cargo.toml` - add `quinn`, `h3`, `h3-quinn`, `aes`; dev-deps for the loopback server if not already present (`rcgen` already a dev-dep).

Create/modify (TS, `src/`):
- `lib/workspace/model.ts` - `export type HttpVersion = "auto" | "h3";` add **optional** `httpVersion?: HttpVersion` to `RequestNode` (absent = `"auto"`, mirroring the disk contract - avoids churning every fixture/construction site). A `requestHttpVersion(node): HttpVersion` reader (`node.httpVersion ?? "auto"`) centralizes the default.
- `lib/http/model.ts` - add `httpVersion: HttpVersion` to `HttpRequest`.
- `lib/http/build-request.ts` - thread `node.httpVersion` into both `HttpRequest` returns.
- `lib/workspace/disk-format.ts` - serialize `httpVersion` on the request doc (omit when `"auto"`); read it in `parseRequest` (absent → `"auto"`); bump manifest `schemaVersion` `5 → 6`.
- `lib/http/tauri-client.ts` - pass `httpVersion` in the `invoke` payload.
- `components/workspace/config-panels.tsx` - version `Select` (Auto / HTTP/3) in the request Settings tab (`GeneralPanel`), beside the timeout field.
- `components/workspace/workspace-context/*` - a `setRequestHttpVersion(id, v)` action + wherever `setRequestMethod` is defined/exposed (types.ts, index.tsx).
- Construction sites need **no edit** (optional field, absent = auto); only `tree-crud.ts` new-request stays as-is. Read via `requestHttpVersion(node)` where the value is needed (build-request, url-bar).

Docs:
- `docs/data-format.md` - `schemaVersion 6`, new `httpVersion` field on the request doc, migration line.

No change to `dissect.rs`, `hpack.rs`, `tap_client.rs`, `pcap_capture.rs`.

## Task 1: Data model - `httpVersion` field + `schemaVersion 6`

**Files:** Modify `model.ts`, `disk-format.ts`, request-construction sites. Test `disk-format` test file. Modify `docs/data-format.md`.

**Interfaces:**
- Produces: `HttpVersion = "auto" | "h3"`; `RequestNode.httpVersion?: HttpVersion`; `requestHttpVersion(node): HttpVersion`; disk round-trip (omit-when-auto); manifest `schemaVersion: 6`.

- [ ] RED: serialize a node with `httpVersion:"h3"` → `.req.json` has `"httpVersion":"h3"` + manifest `schemaVersion:6` (TC-007); serialize `"auto"` → no `httpVersion` key (TC-008); deserialize v5 doc lacking the field → `"auto"`, deserialize `"h3"` → `"h3"` (TC-009).
- [ ] Confirm RED for the right reason (field/type absent).
- [ ] GREEN: add the type + field (default `"auto"` at every construction site), serialize omit-when-auto, parse-with-default, bump `schemaVersion`.
- [ ] Update `docs/data-format.md`.
- [ ] Commit `feat(http3): AC-003 persist httpVersion per-request, schemaVersion 6`.

## Task 2: Settings-tab version selector

**Files:** Modify `config-panels.tsx` (`GeneralPanel`), `request-pane.tsx`, workspace-context (`types.ts` + `index.tsx` + the send/context module owning setters). Test `general-panel` test (+ context surface test).

**Interfaces:**
- Consumes: `RequestNode.httpVersion` (Task 1), `setRequestHttpVersion`.
- Produces: `setRequestHttpVersion: (id: string, v: HttpVersion) => void` on the workspace context.

- [ ] RED: the request Settings tab renders a version selector; choosing `HTTP/3` calls the setter with `"h3"`; the trigger reflects the request's stored version (TC-010).
- [ ] Confirm RED (no selector / no setter).
- [ ] GREEN: add the setter to context, render an optional `Select` (Auto / HTTP/3) in `GeneralPanel` (request-only; folder Settings omits it) beside the timeout field.
- [ ] Commit `feat(http3): AC-004 Settings-tab HTTP version selector`.

## Task 3: Wire plumbing (TS → Rust payload)

**Files:** Modify `http/model.ts`, `build-request.ts`, `tauri-client.ts`; Rust `lib.rs` (`HttpRequestPayload.http_version`, `#[serde(default)]`). Test `build-request` test + a `lib.rs` deserialize test.

**Interfaces:**
- Consumes: `RequestNode.httpVersion` (Task 1).
- Produces: `HttpRequest.httpVersion`; `HttpRequestPayload.http_version: String` (serde default `"auto"`).

- [ ] RED (TS): `buildHttpRequest` threads `node.httpVersion` into the wire `HttpRequest` (both bodyless + bodied returns). RED (Rust): a payload JSON with no `httpVersion` deserializes to `http_version == "auto"`; with `"h3"` → `"h3"`.
- [ ] Confirm RED.
- [ ] GREEN: add the field both sides + serde default; pass through `tauri-client` invoke.
- [ ] Commit `feat(http3): AC plumbing thread httpVersion to the wire payload`.

## Task 4: QUIC crypto primitives + RFC 9001 Appendix-A gate

**Files:** Create `quic_crypto.rs` + its tests. Modify `Cargo.toml` (add `aes`; `ring` already present).

**Interfaces:**
- Produces:
  - `fn hkdf_expand_label(secret: &[u8], label: &[u8], length: usize, suite: Suite) -> Vec<u8>`
  - `fn initial_secrets(dcid: &[u8], version: u32) -> (Vec<u8> /*client*/, Vec<u8> /*server*/)`
  - `struct PacketKeys { key, iv, hp }` with `fn derive(secret: &[u8], suite: Suite) -> PacketKeys`
  - `fn remove_header_protection(hp: &[u8], sample: &[u8], first_byte: &mut u8, pn_bytes: &mut [u8], suite: Suite)`
  - `fn aead_open(key,iv,pn,header,ciphertext, suite) -> Result<Vec<u8>, ()>`
  - `enum Suite { Aes128Gcm, Aes256Gcm, ChaCha20Poly1305 }`

- [ ] RED: the **RFC 9001 §A.1-A.3 test vector** - the published Initial DCID → the exact client-Initial-packet keys, header-protection sample/mask, and the decrypted CRYPTO/ClientHello bytes (TC-011). All literals from the RFC, offline, deterministic.
- [ ] Confirm RED (functions unimplemented).
- [ ] GREEN: implement HKDF-Expand-Label (ring HKDF), initial-salt derivation, header protection (AES-ECB via `aes` for AES suites; ChaCha20 for the ChaCha suite), AEAD open (ring `aead`). Pass the vector.
- [ ] REFACTOR: collapse the per-suite branches behind `Suite`.
- [ ] Commit `feat(http3): AC-010 QUIC crypto vs RFC 9001 test vector`.

**Gate:** if this task cannot reproduce the published vector, halt and report - the live decrypt (Task 6) is not attempted.

## Task 5: QUIC / HTTP-3 transport send path

**Files:** Create `quic_client.rs` + a loopback h3 test server + tests. Modify `lib.rs` (route `http_version=="h3"` → `send_via_quic`). Modify `Cargo.toml` (`quinn`, `h3`, `h3-quinn`).

**Interfaces:**
- Consumes: `HttpRequestPayload.http_version` (Task 3), `CancellationToken`, `CANCEL_SENTINEL`.
- Produces:
  - `pub async fn send_via_quic(request: HttpRequestPayload, token: CancellationToken) -> Result<(HttpResponsePayload, QuicCapture), String>`
  - `pub struct QuicCapture { peer_addr, local_addr, quic_version, alpn, tls_cipher, datagrams_in: Vec<Datagram>, datagrams_out: Vec<Datagram>, keylog: Vec<KeyLogLine> }` (fields the dissector reads)
  - `TapUdpSocket` (wraps a `quinn`-wrapped std `UdpSocket`, tapping `try_send`/`poll_recv` into shared buffers, timestamped per datagram)
  - `KeyLogCapture` (rustls `KeyLog`; `log(label, client_random, secret)` appends a line)

- [ ] RED: loopback h3 server returns 200 + body + custom header → `send_via_quic` returns them (TC-001); POST body+header round-trips (TC-002); past `timeout_ms` → `Err`, mid-flight cancel → `Err=="__cancelled__"` (TC-003); h3 to a TCP-only/closed UDP port → `Err`, no hang (TC-004); timings partition (TC-005); `send_http_request` with `"auto"` never enters `send_via_quic` (TC-006, assert via a routing-observable seam).
- [ ] Confirm RED.
- [ ] GREEN: build endpoint over `TapUdpSocket`; rustls `ClientConfig` (ALPN `h3`, TLS1.3, webpki roots + test-root seam, `key_log = Arc::new(KeyLogCapture)`); `QuicClientConfig::try_from`; connect; `h3_quinn::Connection::new` → `h3::client::new`; send request, read status/headers/body; redirect loop (`MAX_REDIRECTS`, 301/302/303→GET); `tokio::select!` timeout+cancel mirroring the tap path; timings; populate `QuicCapture`. Route in `lib.rs`.
- [ ] REFACTOR: factor the redirect/timing loop shared shape; keep the h3-crate calls in one thin adapter fn (churn containment).
- [ ] Commit `feat(http3): AC-001/002/005/006/007 QUIC HTTP/3 send path`.

## Task 6: Full QUIC dissection

**Files:** Create `quic_dissect.rs`, `qpack.rs` + tests. Modify `lib.rs` (attach `dissect_quic` on the h3 branch).

**Interfaces:**
- Consumes: `QuicCapture` (Task 5), `quic_crypto` (Task 4), `PacketCapture` + lower-layer helpers (from `dissect.rs`/`pcap_capture`), `Dissection`/`Layer`/`Segment`/`Field` (from `dissect.rs`).
- Produces: `pub fn dissect_quic(capture: &QuicCapture, packets: &PacketCapture) -> Option<Dissection>`; `pub fn decode_qpack(encoded: &[u8]) -> Vec<(String,String)>`.

- [ ] RED: layers include Application(HTTP/3)/TLS/QUIC/UDP; QUIC layer's first segment decodes a long-header packet's version+DCID/SCID at correct byte offsets (TC-012); a Handshake packet decrypts + CRYPTO reassembles a ServerHello/EncryptedExtensions segment (TC-013); a 1-RTT STREAM frame decodes an HTTP/3 HEADERS frame QPACK-decoding to `:status` + content-type (TC-014); empty keylog still returns `Some(_)` with headers decoded + 1-RTT payload marked encrypted, no panic (TC-015). QPACK unit: static-table + literal vectors → expected pairs.
- [ ] Confirm RED.
- [ ] GREEN: parse long/short headers (coalesced-split by declared length, E-1); per-space packet-number decode tracking largest-acked (E-2); Retry/Version-Negotiation header-only (E-3); pick `Suite` from negotiated cipher (E-4); decrypt via Task 4 keys (Initial from salt, Handshake/1-RTT from keylog secrets); reassemble CRYPTO by offset → TLS messages; STREAM → HTTP/3 frames → QPACK; build layers reusing lower-layer helpers; honor `MAX_SEGMENTS`/`MAX_SEGMENT_HEX_BYTES` (E-6); missing keys → encrypted-marked, still `Some` (AC-015); key-phase flip → mark encrypted not mis-decrypt (E-5).
- [ ] REFACTOR: deletion test on `qpack`/`quic_crypto` (are they pulling weight); collapse frame-parse ifology behind a frame-type dispatch.
- [ ] Commit `feat(http3): AC-008..015 full QUIC byte-level dissection`.

## Execution order

TS and Rust tracks are independent until routing:
- TS: Task 1 → Task 2, and Task 3 (TS half).
- Rust: Task 4 (crypto gate) → Task 5 (transport, + Task 3 Rust half + routing) → Task 6 (dissection).

Task 4 first is deliberate (risk-first gate). Task 6 needs both 4 (crypto) and 5
(live capture). After Task 6: `cargo test` full + `npm test` full + `tsc` + lint.

## Edge cases (from spec)

E-1 coalesced packets (split by length); E-2 truncated PN (largest-acked per space);
E-3 Retry/Version-Negotiation (header-only); E-4 ChaCha suite (ChaCha HP+AEAD);
E-5 key update (mark encrypted); E-6 large body (cap segments/bytes);
E-7 `h3` on `http://` (unsupported-scheme Err); E-8 unknown QUIC version
(header-decoded, payload not decrypted); E-9 0-RTT (none expected, header-decode if seen).

## Risks

- **QUIC crypto** is the dominant risk - gated by the offline RFC 9001 vector (Task 4) before any live path; halt-and-report if it can't reproduce.
- **`h3` crate is experimental** - pin exact versions, isolate h3 calls in one adapter fn in `quic_client.rs`.
- **`h3::client` exact builder signature** (`h3::client::new` vs `builder().build`) confirmed at impl against the pinned `h3` version (docs show `h3::client` module with `builder`/`new`); thin adapter contains any difference.
- **Loopback h3 test server** must offer a self-signed cert trusted via the existing `TEST_EXTRA_ROOTS` seam (reuse the tap test's `rcgen` pattern) + ALPN `h3`.
- **Binary size / build time** grows (quinn+h3); acceptable for desktop, noted for release.

## Acceptance verification

Every AC → ≥1 TC (spec mapping). Concrete proof points: RFC 9001 vector (TC-011,
offline) for crypto correctness; loopback h3 round-trip (TC-001) for transport;
loopback decrypt+decode (TC-013/014) for dissection. Final: fresh-context verifier
+ a live h3 send through the running app against a real HTTP/3 endpoint, inspecting
the Protocols tab shows decoded QUIC/TLS/HTTP-3 layers.

## Glossary terms (resolved while planning)

- **httpVersion** - the request-local, persisted transport-version choice
  (`"auto"` | `"h3"`). _Avoid_: "protocol" (overloaded - method/scheme/OSI layer).
- **QuicCapture** - the byte-level record of one QUIC send (tapped datagrams +
  exported TLS secrets + negotiated params) the dissector consumes. Parallel to
  the tap path's `Capture`. _Avoid_: "trace", "log".
