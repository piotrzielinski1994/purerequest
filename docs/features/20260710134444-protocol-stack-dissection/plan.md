# Plan: tap-client-parity (protocol-stack-dissection sub-task 1/5)

Spec: `./spec.md`. Epic + ACs: `.pzielinski/protocol-stack-dissection.md`.

## Approach

Hand-roll the send on reqwest's own guts so we own the socket + TLS session:

```
send_via_tap(payload, token)
  -> resolve host (timed, reuse TimingResolver approach)
  -> TcpStream::connect(addr)                          [connect span starts]
  -> wrap in TapStream (logs raw bytes)  ── if https ──> tokio_rustls TlsConnector (ALPN h2+h1)
                                                          -> read negotiated ALPN + version + cipher
                                                          -> wrap TlsStream in TapStream (logs app-data)
  -> hyper handshake: http2 if alpn==h2 else http1     [connect span ends]
  -> build http::Request from payload, send            [waiting: to response headers]
  -> read body via http-body-util BodyExt::collect     [download]
  -> decompress by Content-Encoding (flate2/brotli)
  -> if 3xx + Location and redirects < 10: rebuild request for the new url, loop
  -> assemble HttpResponsePayload + Capture
```

Cancellation: wrap each await (`connect`, `handshake`, `send`, body read) in the same
`tokio::select! { _ = token.cancelled() => Err(SENTINEL), r = fut => r }` pattern already used.

Timing: reuse the partition logic. DNS from a timed `lookup_host`; connect span measured around
TCP+TLS+handshake; `to_headers` at response-headers arrival; download around the body collect.

### Files

- `src-tauri/src/tap_client.rs` (new) - `send_via_tap`, `TapStream`, `Capture`, redirect loop,
  decompression, timing wiring. Owns all the new logic.
- `src-tauri/src/lib.rs` - add `mod tap_client;`; in `send_http_request`, branch on the
  `PUREREQUEST_TAP_CLIENT` flag: tap path calls `tap_client::send_via_tap`, else the existing reqwest
  path. Keep the `CancellationToken` registry + `CancelGuard` shared (pass the token in).
- `src-tauri/Cargo.toml` - add direct deps (see spec §6) pinned to the lock versions; install the
  `ring` rustls crypto provider once (via `rustls::crypto::ring::default_provider().install_default()`
  in `run()` setup, guarded so double-install is a no-op).
- `src-tauri/Cargo.toml` `[dev-dependencies]` - add `rcgen` + `tokio-rustls` server bits for the
  loopback TLS test server; `flate2` for building gzip test bodies.

### Flag

`fn use_tap_client() -> bool { std::env::var("PUREREQUEST_TAP_CLIENT").map(|v| v != "0").unwrap_or(true) }`
- default ON; set `PUREREQUEST_TAP_CLIENT=0` to force the legacy reqwest path. Both compiled always.

### Tap seam

`TapStream<S> { inner: S, read_log: Arc<Mutex<Vec<u8>>>, write_log: Arc<Mutex<Vec<u8>>> }`
implementing `AsyncRead`/`AsyncWrite`, appending to the logs in `poll_read`/`poll_write`. One
instance wraps the `TcpStream` (raw TLS records / plaintext HTTP for `http://`), another wraps the
`TlsStream` (decrypted app-data). The logs are the `Capture` byte fields.

## Edge cases handled (from spec §5)

- Redirect cap 10 + visited-set loop guard -> `Err("too many redirects")`.
- 303 -> GET + drop body; 301/302/307/308 per reqwest semantics (307/308 keep method+body).
- `http://` -> skip TLS, tap only the TcpStream, `Capture.tls_*` = None.
- chunked / no-content-length -> hyper's body collect handles it.
- cancel at any await -> sentinel; timeout wraps the whole send in `tokio::time::timeout`.
- transport/TLS/dns errors -> `Err(String)`; no `unwrap` on network results.
- empty body -> "", sizeBytes 0.

## Tests (Rust cargo, RED first) - written by a fresh test-writer subagent

Per-AC/TC mapping in the epic file. Plaintext parity tests (TC-001,002,004,005,007,008,009,011)
use `wiremock` (loopback HTTP). TLS tests (TC-003 is plaintext; TC-006 ALPN, TC-010 tap points)
use a small loopback `tokio-rustls` server with an `rcgen` self-signed cert, the client pointed at
it with that cert trusted (test-only root). `partition` unit tests already exist and stay green.

## Acceptance verification

- `cd src-tauri && cargo test` green with the flag both ON (default) and `PUREREQUEST_TAP_CLIENT=0`.
- `cargo clippy` clean (no `unwrap` on fallible network paths).
- Existing reqwest tests still pass (flag-off path) - proves AC-011 + no regression.
- Frontend `npm test` untouched by this sub-task (no TS change) - run once to confirm no drift.
- Manual: `npm start`, send a real https GET, confirm status/body/headers/timing unchanged.
