# Spec: tap-client-parity (protocol-stack-dissection sub-task 1/5)

Part of the `protocol-stack-dissection` epic (see `.pzielinski/protocol-stack-dissection.md`
for the full 5-sub-task breakdown and the confirmed maximal scope).

## 1. Overview

Replace the reqwest-based `send_http_request` with a **hand-rolled network client** built on
`hyper` + `hyper-util` + `tokio-rustls` (the same crates reqwest uses internally), so ReqUI owns
the `TcpStream` and the TLS session. Owning them is the precondition for the later dissection
sub-tasks: we can tap the raw TLS record bytes (below rustls), the decrypted application-data
bytes (above rustls), the negotiated TLS params, and the socket peer/local `IP:port`.

This sub-task ships **functional parity only** - no dissection model, no UI. The tap points are
captured into an in-memory `Capture` struct and proven by a Rust test; they are not yet serialized
to the frontend.

The cutover is guarded by a runtime flag (`REQUI_TAP_CLIENT`, default ON) so both the reqwest and
tap paths stay compiled and testable during the epic and the change is reversible.

### Scope

In:
- New Rust module `tap_client` with `send_via_tap(payload, token) -> Result<(HttpResponsePayload, Capture), String>`.
- TCP connect + `tokio-rustls` TLS (ALPN offering `h2` + `http/1.1`) + `hyper` client conn
  (`http1` or `http2` branched on the negotiated ALPN protocol).
- Byte-tapping stream adapter (`TapStream`) wrapping both the `TcpStream` (raw TLS records) and
  the `TlsStream` (decrypted app-data) into shared buffers.
- Redirect-follow (hand-rolled loop over `Location`, bounded + loop-guarded), matching reqwest's
  default of following up to 10 redirects.
- gzip / br transparent decode of the response body when `Content-Encoding` is present (`flate2`,
  `brotli`).
- The four #6 timing phases (DNS via the existing `TimingResolver` approach, connect = TCP+TLS
  span, waiting = to-headers, download = body read), summing to `timeMs`.
- Cancellation via the existing `CancellationToken` registry (`tokio::select!` on the token).
- `Capture` struct holding: peer + local `SocketAddr`, negotiated ALPN protocol, TLS
  version/cipher (when TLS), raw TLS record read/write byte logs, decrypted app-data read/write
  byte logs. Populated on the send path; asserted by a Rust test (AC-010).
- Runtime flag selecting reqwest vs tap inside `send_http_request` (AC-011).

Out (later sub-tasks / deferred):
- Any decoder MODEL over the captured bytes (h1 -> sub-task 2, h2 -> sub-task 3, TLS -> sub-task 4).
- The Protocols tab UI (sub-task 5).
- Serializing `Capture` to the frontend (sub-task 2 adds the `dissection` payload field).
- Real IP/TCP header bytes (needs root; permanently out - socket facts only).
- HTTP/2 body DISPLAY decoding (hyper handles the h2 wire in this sub-task; our own h2 decoder is
  sub-task 3).

### Decisions (made under user's "do it as you see fit" grant)

- **Build on hyper + tokio-rustls directly**, not a from-scratch HTTP parser. reqwest is a thin
  layer over these; using them gives h1+h2 parity for free while still handing us the raw socket
  and TLS session to tap. A from-scratch parser would be sub-task 2/3's job for the DISPLAY layer,
  not the send path.
- **h2 wire via hyper** in this sub-task (the `h2` crate is pulled in transitively by hyper's
  `http2` feature). True parity + captured bytes now; our own h2 byte-decoder for display is
  sub-task 3.
- **Redirect hand-rolled, compression via crates** (`flate2`/`brotli`). Redirect is a simple loop;
  hand-rolling inflate/brotli would be a bug farm.
- **Runtime flag `REQUI_TAP_CLIENT`** (default ON), not a compile-time cargo feature, so one
  `cargo test` run exercises both clients.
- **Tap at the stream I/O boundary** (wrap the streams), not via `SSLKEYLOGFILE` - the plaintext
  is exactly what we read/write through the `TlsStream`, so no key export is needed.

## 2. Acceptance Criteria

See `.pzielinski/protocol-stack-dissection.md` -> "SUB-TASK 1 Acceptance Criteria" (AC-001..AC-011).
That file is the single source of truth; not duplicated here to avoid drift.

## 3. User Test Cases

See the same file -> "Test Cases (sub-task 1)" (TC-001..TC-011).

## 4. Data model

```rust
struct Capture {
    peer_addr: Option<SocketAddr>,
    local_addr: Option<SocketAddr>,
    alpn: Option<String>,           // "h2" | "http/1.1"
    tls_version: Option<String>,    // e.g. "TLSv1.3"
    tls_cipher: Option<String>,     // e.g. "TLS13_AES_128_GCM_SHA256"
    tls_records_in: Vec<u8>,        // raw bytes read below rustls
    tls_records_out: Vec<u8>,       // raw bytes written below rustls
    app_data_in: Vec<u8>,           // decrypted bytes read above rustls
    app_data_out: Vec<u8>,          // decrypted bytes written above rustls
}
```

`HttpResponsePayload` is unchanged in this sub-task (no `dissection` field yet - that is sub-task 2).

## 5. Edge cases

- Redirect loop (A -> B -> A) stops at the 10-redirect cap with a transport error, not an infinite loop.
- A redirect that drops the body/switches to GET on 303 follows reqwest's semantics.
- `http://` (no TLS): no `TapStream` below rustls, `Capture.tls_*` all `None`, records empty.
- A response with no `Content-Length` and `Transfer-Encoding: chunked` is read to completion by hyper.
- Cancel fired before connect, during TLS, and during body read all resolve to the sentinel.
- Timeout during connect vs during body read both yield `Err`.
- An unresolvable host / connection refused / TLS cert failure yield `Err(String)`, never a panic.
- Empty body (204/HEAD) yields an empty body string, sizeBytes 0.

## 6. Dependencies

New direct Cargo deps (all already transitively present via reqwest -> pinned to lock versions):
`hyper` (features `client`, `http1`, `http2`), `hyper-util` (`tokio`, `client-legacy`?),
`tokio-rustls`, `rustls`, `rustls-pki-types`, `http-body-util`, `webpki-roots`, `flate2`, `brotli`,
`bytes`. `rustls` needs a default crypto provider installed once (`aws-lc-rs` or `ring` - match
whatever reqwest's rustls-tls pulls). Dev: a loopback TLS test server (reuse `wiremock` for h1
plaintext; add an `https` mock via `wiremock`'s TLS support or a small rustls acceptor + `rcgen`
self-signed cert for the TLS-path tests).
