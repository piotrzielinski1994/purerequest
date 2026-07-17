# HTTP/3 (QUIC) support + full QUIC dissection

Branch: `20260717112126-http3-quic`

## Overview

The client speaks only `http://`/`https://` over **HTTP/1.1 + HTTP/2** today: the
hand-rolled tap client (`tap_client.rs`) connects over **TCP**, wraps it in
`tokio-rustls` offering ALPN `h2` + `http/1.1`, taps the wire bytes, and feeds
`dissect.rs` a byte-level OSI dissection (the Protocols tab). There is no
**HTTP/3**, which runs over **QUIC on UDP** - a different transport and a
different crypto layer, so ALPN-over-TCP cannot reach it.

This feature adds HTTP/3 as an **explicit, per-request opt-in** (like
`curl --http3`; nothing auto-upgrades) and extends the Protocols tab to a
**full byte-level QUIC dissection** on par with the existing TLS/HTTP-2 decode:
raw UDP datagrams are tapped, TLS secrets are exported via a keylog, and the
captured packets are decrypted and decoded down to QUIC frames, the reassembled
TLS 1.3 handshake, HTTP/3 frames, and QPACK-decoded headers.

Two coupled subsystems, one spec (user decision, 2026-07-17):

1. **Transport** - a new QUIC/HTTP-3 send path (`quic_client.rs`) selected when a
   request's version is `h3`, returning the same `HttpResponsePayload`
   (status/headers/body/timings) the tap path returns.
2. **Dissection** - a QUIC decoder (`quic_dissect.rs`) that turns the tapped UDP
   datagrams + exported secrets into the layered `Dissection` the Protocols tab
   already renders.

Subsystem 2 depends on 1 (it decodes the live session 1 produces), but each has
independently checkable acceptance criteria.

## Version selection model

- New type `HttpVersion = "auto" | "h3"`.
  - `auto` - today's behaviour unchanged: tap client over TCP, ALPN `h2` +
    `http/1.1` (negotiated). Forces nothing.
  - `h3` - forces QUIC/HTTP-3; if the server has no HTTP/3 the send fails with a
    clear transport error (no silent fallback - matches `curl --http3`).
- **Persisted per-request**, flat on the request doc like `method`/`url`, and
  **not inherited** (body/params/method are the non-inherited request-local
  fields; version joins them). Stored as `httpVersion` on `<request>.req.json`,
  **omitted when `auto`** (minimal diff). Absent on load ⇒ `auto`.
- Manifest `schemaVersion` bumps **5 → 6**. A v5 (or earlier) doc with no
  `httpVersion` loads as `auto` and rewrites at v6 on next save. No file needs
  rewriting for correctness (absent already means `auto`); the bump records that
  the field now exists.

This is a durable data-format change - [docs/data-format.md](../../data-format.md)
is updated in the same change (new `httpVersion` field + `schemaVersion 6` +
migration line).

## Subsystem 1 - Transport (QUIC / HTTP-3 send)

A new `quic_client::send_via_quic(request, token) -> Result<(HttpResponsePayload, QuicCapture), String>`
mirroring `tap_client::send_via_tap`'s signature and responsibilities:

- Build a `quinn::Endpoint` (client) over a **custom `AsyncUdpSocket`**
  (`TapUdpSocket`) that copies every datagram in/out into shared buffers - the
  UDP analogue of `tap_client`'s `TapStream`.
- rustls `ClientConfig` with ALPN `h3`, TLS 1.3 only, the same webpki roots +
  test-root seam the tap client uses, and a **custom `KeyLog`** capturing the
  SSLKEYLOGFILE-format secret lines (label, client-random, secret) into a buffer
  for the dissector. Converted to a `quinn::crypto::rustls::QuicClientConfig`.
- Drive `h3` + `h3-quinn`: open the connection, send one request (method, `:path`
  from URL, headers, optional body), read the response status/headers/body.
- Follow redirects to parity with the tap path (same `MAX_REDIRECTS`, same
  301/302/303→GET rewrite), re-dialling QUIC per hop.
- Enforce `timeout_ms` and the `CancellationToken` exactly as the tap path does
  (same `__cancelled__` sentinel, same `tokio::select!` structure).
- Partition timings into the same four phases (dns / connect / waiting /
  download). `connect` spans the QUIC handshake (which folds TLS into the
  transport handshake); `waiting` is request-sent → response-headers; `download`
  is body read.
- Return a `QuicCapture` (peer/local addr, negotiated QUIC version, ALPN, TLS
  cipher, the tapped datagram buffers in/out, and the exported keylog lines).

`send_http_request` (lib.rs) routes on the new payload field: `httpVersion == "h3"`
→ `send_via_quic`; otherwise the existing tap-vs-reqwest selection is unchanged.
The `REQUI_PCAP` side-car already captures L2-L4 by 4-tuple and is
protocol-agnostic, so it is started for the h3 path too (fills the real IP/UDP
header bytes when enabled; facts-only otherwise), exactly as for TCP.

Wire payload gains `httpVersion: String` (`HttpRequestPayload`); the TS
`HttpRequest` gains `httpVersion: HttpVersion`, threaded from the persisted node
through `buildHttpRequest`.

## Subsystem 2 - Full QUIC dissection

A new `quic_dissect::dissect_quic(capture: &QuicCapture, packets: &PacketCapture) -> Option<Dissection>`
producing the same `Dissection { layers: Vec<Layer> }` shape the Protocols tab
renders (byte-backed `Segment`s with per-field byte/bit ranges + honest `Reach`).
It is wired into `send_http_request` for the h3 branch the way `dissect_with_packets`
is for the tap branch. Existing `dissect.rs` is untouched (it stays the TCP/TLS
decoder); QUIC gets its own module because the packet model is entirely different.

Layers, top → bottom, each honest about reach:

- **Application (HTTP/3)** - `Decoded`. HTTP/3 frames parsed from the reassembled
  request/response/control STREAM data: `HEADERS` (QPACK-decoded to name/value
  pairs), `DATA`, `SETTINGS`. QPACK: static table + literal representations, and
  the dynamic table when the peer uses it.
- **Session/Presentation (TLS 1.3 over QUIC)** - `Decoded` when secrets present.
  CRYPTO frames reassembled (by offset) into TLS handshake messages: ClientHello,
  ServerHello, EncryptedExtensions, Certificate, CertificateVerify, Finished.
- **Transport (QUIC)** - `Decoded`. Long-header packets (Initial / Handshake /
  0-RTT / Retry) and short-header (1-RTT) parsed to byte-level fields (version,
  DCID/SCID + lengths, token, packet-number length + value, key phase). Payloads
  decrypted then parsed into QUIC frames (CRYPTO, STREAM, ACK, NEW_CONNECTION_ID,
  PADDING, PING, CONNECTION_CLOSE, …). **Initial** packets decrypt with the
  version-salt-derived keys (deterministic, no secret needed). **Handshake** and
  **1-RTT** decrypt with the keylog-exported secrets (HKDF-Expand-Label → QUIC
  key/iv/hp, header-protection removal, AEAD open).
- **Transport (UDP)** - `Decoded` for datagram boundaries/length from the tap;
  `Facts` for ports/addresses (from the socket) unless pcap supplied real UDP
  header bytes (then `Decoded`), mirroring the existing split.
- **Network (IP) / Data-Link / Physical** - identical to `dissect.rs`: `Decoded`
  from a sample pcap packet when `REQUI_PCAP=1`, else `Facts`/`Privileged`/
  `Unreachable` as today. Reuse the existing lower-layer helpers.

Crypto is implemented against RFC 9001 (QUIC-TLS): HKDF-Expand-Label with QUIC
labels (`quic key`, `quic iv`, `quic hp`, and the initial-secret salt), header
protection (AES-ECB sample-mask for AES suites, ChaCha20 for the ChaCha suite),
and AEAD open (AES-128/256-GCM, ChaCha20-Poly1305). `ring` (already a dep)
covers HKDF + AEAD; the AES-ECB header-protection block uses the `aes` crate.

## Acceptance criteria

Transport:

- **AC-001**: A request with `httpVersion: "h3"` sent to an HTTP/3 server
  completes over QUIC and returns the correct status, response headers, and body.
- **AC-002**: `httpVersion: "auto"` (or absent) is byte-for-byte the current
  behaviour - tap client over TCP, ALPN `h2`+`http/1.1`; no QUIC code runs.
- **AC-003**: `httpVersion` persists on `<request>.req.json`, **omitted when
  `auto`**, present as `"h3"` otherwise; manifest `schemaVersion` is `6`; a doc
  with no `httpVersion` loads as `auto`; a doc written after selecting `h3`
  round-trips `h3`.
- **AC-004**: The URL bar exposes a version selector with `Auto` and `HTTP/3`;
  selecting a value updates the active request and persists it (survives reload).
- **AC-005**: An h3 send honours `timeoutMs` (returns `Err` past it) and
  cancellation (a mid-flight cancel resolves to the `__cancelled__` sentinel).
- **AC-006**: An h3 send to a host with no HTTP/3 (QUIC handshake fails / times
  out) returns a clear transport `Err` and never hangs.
- **AC-007**: An h3 response carries `timings` whose four phases partition the
  total (sum ≤ `time_ms`, within a small rounding gap), like the tap path.

Dissection:

- **AC-008**: An h3 response carries a `Dissection` whose layers include, top to
  bottom, Application (HTTP/3), TLS 1.3, QUIC (transport), and UDP - each with an
  honest `Reach`.
- **AC-009**: The QUIC layer decodes long-header and short-header packet fields
  (version, DCID/SCID, packet type, packet-number length/value, key phase) from
  the tapped datagram bytes as byte-backed segments with correct byte ranges.
- **AC-010**: Initial packets are decrypted with the version-salt-derived initial
  keys (no exported secret) and their CRYPTO frames exposed. Verified against the
  RFC 9001 Appendix-A test vector (deterministic, offline).
- **AC-011**: Handshake and 1-RTT packets are decrypted using the keylog-exported
  TLS secrets (HKDF-derived QUIC keys + header-protection removal + AEAD open) and
  their frames exposed.
- **AC-012**: CRYPTO frames reassemble into the TLS 1.3 handshake messages
  (ClientHello, ServerHello, EncryptedExtensions, Certificate, Finished) as
  decoded segments.
- **AC-013**: STREAM-frame data on the request/response streams decodes into
  HTTP/3 frames (HEADERS, DATA) and the control stream into SETTINGS.
- **AC-014**: HTTP/3 HEADERS frames QPACK-decode into the correct header
  name/value pairs (static table + literal representations, and dynamic-table
  references when the peer uses them).
- **AC-015**: If the keylog is empty (secrets unavailable), Handshake/1-RTT
  packets still show their decoded headers with the payload marked encrypted
  (`Reach` honest) and the dissection as a whole still returns - it never fails
  or panics on missing keys.

## Test cases

Transport (Rust, `quic_client` tests + a loopback h3 server):

- **TC-001** (AC-001): a loopback QUIC/h3 server returns 200 + a body + a custom
  response header; `send_via_quic` returns status 200, that body, that header.
- **TC-002** (AC-001): a POST with a body + custom request header round-trips
  (server matches on both, replies 200).
- **TC-003** (AC-005): a delayed server past a small `timeout_ms` → `Err`; a
  mid-flight `token.cancel()` on a hanging send → `Err == "__cancelled__"`.
- **TC-004** (AC-006): connecting `h3` to a closed UDP port / a TCP-only server
  → `Err`, no hang (bounded by the idle/handshake timeout).
- **TC-005** (AC-007): a successful h3 send carries `timings` whose four phases
  sum to ≤ `time_ms` and ≥ `time_ms - rounding`.
- **TC-006** (AC-002): `send_http_request` with `httpVersion: "auto"` still goes
  through the tap path (existing tap/reqwest tests remain green; a routing test
  asserts `"auto"` does not enter `send_via_quic`).

Data model (TS, `disk-format` tests):

- **TC-007** (AC-003): serialize a request with `httpVersion: "h3"` → the
  `.req.json` has `"httpVersion": "h3"`; manifest `schemaVersion` is `6`.
- **TC-008** (AC-003): serialize a request with `httpVersion: "auto"` → **no**
  `httpVersion` key on disk (minimal diff).
- **TC-009** (AC-003): deserialize a v5 doc with no `httpVersion` → node
  `httpVersion === "auto"`; deserialize a doc with `"h3"` → `"h3"`.

UI (TS, url-bar test):

- **TC-010** (AC-004): the URL bar renders a version selector; choosing `HTTP/3`
  calls the setter with `"h3"` for the active request; the value reflects the
  request's stored version.

Dissection (Rust, `quic_dissect` tests):

- **TC-011** (AC-010): decode the RFC 9001 Appendix-A Initial packet test vector
  → the expected CRYPTO frame / ClientHello bytes (offline, deterministic).
- **TC-012** (AC-008/009): after a loopback h3 send, `dissect_quic` returns
  layers including Application(HTTP/3)/TLS/QUIC/UDP; the QUIC layer's first
  segment decodes a long-header packet's version + DCID/SCID fields at the
  correct byte offsets.
- **TC-013** (AC-011/012): with the loopback send's captured secrets, a Handshake
  packet decrypts and its CRYPTO frames reassemble a ServerHello /
  EncryptedExtensions message decoded as a segment.
- **TC-014** (AC-013/014): a 1-RTT packet's STREAM frame decodes an HTTP/3
  HEADERS frame that QPACK-decodes to include `:status` and the response
  content-type header.
- **TC-015** (AC-015): `dissect_quic` called with an empty keylog still returns
  `Some(_)` with QUIC packet headers decoded and 1-RTT payloads marked encrypted
  (no panic, no `None`).

## Edge cases

- **E-1** Coalesced packets - one UDP datagram carrying multiple QUIC packets
  (e.g. Initial + Handshake): split by consuming each packet's declared length
  before decoding the next.
- **E-2** Packet-number decoding - truncated PN needs the largest-acked PN in
  that space; track per-space state while walking packets in capture order.
- **E-3** Retry / Version-Negotiation packets - decode their headers; they carry
  no protected payload (no decrypt).
- **E-4** ChaCha20-Poly1305 suite - header protection uses ChaCha20 (not
  AES-ECB) and AEAD uses ChaCha20-Poly1305; select the crypto by negotiated
  cipher suite.
- **E-5** Key update (1-RTT key-phase bit flips mid-connection) - rare for a
  single short request; decode the phase bit and, if it flips, mark subsequent
  1-RTT payloads encrypted rather than mis-decrypting. Not a required decode path.
- **E-6** Large body spanning many packets/STREAM frames - cap decoded
  segments/bytes with the existing `MAX_SEGMENTS` / `MAX_SEGMENT_HEX_BYTES`
  discipline so a big transfer can't bloat the payload.
- **E-7** `h3` selected on an `http://` URL - QUIC requires TLS; treat like the
  tap path's unsupported-scheme error (h3 needs `https://`).
- **E-8** Server offers h3 but negotiates a QUIC version this client doesn't
  implement decryption for - transport still works (quinn handles it); dissection
  marks the unknown-version packets header-decoded, payload-not-decrypted.
- **E-9** 0-RTT - not used (fresh connection, no session ticket reuse); decode
  a 0-RTT packet header if present but expect none.

## Dependencies

- **Rust (new):** `quinn` 0.11 (QUIC transport, custom `AsyncUdpSocket`,
  `QuicClientConfig`), `h3` + `h3-quinn` (HTTP/3 over quinn), `aes` (header-
  protection ECB block). `ring` (HKDF + AEAD) and `rustls` 0.23 / `webpki-roots`
  are already deps and are reused. `quinn` pulls `quinn-proto`.
- **TS (new):** none. A `HttpVersion` type + reuse of the existing shadcn
  `Select` for the version selector.
- **On-disk:** `schemaVersion 5 → 6`, new optional `httpVersion` field. Documented
  in [docs/data-format.md](../../data-format.md).
- Reuses the existing `Dissection`/`Layer`/`Segment`/`Field` model, the
  `pcap_capture` side-car, and the lower-layer (IP/link/physical) helpers.

## Risks

- **QUIC crypto derivation is the largest risk**: HKDF-Expand-Label + header
  protection + AEAD open per packet space, by cipher suite. Mitigation: Initial
  keys are deterministic and pinned against the RFC 9001 Appendix-A test vector
  offline (TC-011) before any live path; 1-RTT/Handshake decrypt is validated
  end-to-end against the loopback h3 server whose secrets we capture (TC-013/14).
- **`h3` crate is experimental** (API may churn): pin the exact version, keep a
  thin adapter in `quic_client.rs` so churn is contained to one file.
- **QPACK dynamic table**: a fresh short request usually uses the static table +
  literals; full dynamic-table decode is the harder path - covered but flagged.
- **Binary size / build time** grows with quinn + h3; acceptable for a desktop
  app, noted for the release build.
- **Scope**: full dissection rivals the entire existing tap+dissect+hpack stack
  in size (flagged twice pre-spec; combined-spec is a deliberate user decision).

## Decision log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-17 | Design gate: **pz-ddd N/A** (no domain model - a transport + a byte decoder), **pz-archetypes N/A** (not a domain shape), **pz-codebase-design applies** (new `quic_client` + `quic_dissect` module interfaces, the version-selection seam through the request model, and the decision to keep QUIC decoding in its own module rather than branching `dissect.rs`). | Mandatory gate; only the module-interface skill matches. |
| 2026-07-17 | Version selector is **Auto / HTTP/3** (two states), not a full h1/h2/h3 enum. | YAGNI: the ask is HTTP/3. `auto` preserves today's negotiation; forcing h1/h2 is not requested and would add selection logic that doesn't exist. |
| 2026-07-17 | `httpVersion` is **persisted per-request, flat, non-inherited**; `schemaVersion 5 → 6`; omitted on disk when `auto`. | Matches how `method`/`url`/`body` live on the request (non-inherited request-local fields). Omit-when-default keeps diffs minimal; the bump records the new field. |
| 2026-07-17 | New QUIC/HTTP-3 send path is **hand-rolled on quinn + h3 with a custom `AsyncUdpSocket` + custom `KeyLog`**, NOT reqwest's experimental `http3` feature. | The byte tap + secret export are exactly the seams the Protocols-tab dissection needs; reqwest's http3 gives neither. Mirrors the existing hand-rolled `tap_client` (ADR: tap client owns the socket to tap the wire). |
| 2026-07-17 | QUIC dissection lives in a **new `quic_dissect.rs`**, leaving `dissect.rs` as the TCP/TLS decoder. | The QUIC packet model (UDP datagrams, packet spaces, per-space keys, frames) shares almost nothing with the TCP/TLS/HTTP-2 decode; one module per protocol keeps each single-purpose and testable (deletion test). |
| 2026-07-17 | Full dissection specced as one combined feature with subsystem-1 (transport). | User decision after the split was offered and the size flagged twice. |
