use std::future::poll_fn;
use std::io::{self, IoSliceMut};
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use bytes::{Buf, Bytes};
use hyper::http;
use quinn::udp::{RecvMeta, Transmit};
use quinn::{AsyncUdpSocket, Runtime, UdpPoller};
use tokio_util::sync::CancellationToken;

use crate::{CANCEL_SENTINEL, HttpRequestPayload, HttpResponsePayload, KeyValue, ResponseTimings};

const MAX_REDIRECTS: usize = 10;

// Byte-level record of one QUIC/HTTP-3 send: the negotiated transport params, the tapped
// UDP datagrams in/out, and the SSLKEYLOGFILE-format secret lines. Parallel to the tap
// path's `Capture`; the QUIC dissector (later sub-task) reads these fields.
#[allow(dead_code)]
#[derive(Debug, Default, Clone)]
pub struct QuicCapture {
    pub peer_addr: Option<SocketAddr>,
    pub local_addr: Option<SocketAddr>,
    pub quic_version: Option<u32>,
    pub alpn: Option<String>,
    pub tls_cipher: Option<String>,
    pub datagrams_in: Vec<Vec<u8>>,
    pub datagrams_out: Vec<Vec<u8>>,
    pub keylog: Vec<String>,
}

// Shared byte buffers a TapUdpSocket appends to: one datagram per Vec, in capture order.
#[derive(Clone, Default)]
struct DatagramTap {
    datagrams_in: Arc<Mutex<Vec<Vec<u8>>>>,
    datagrams_out: Arc<Mutex<Vec<Vec<u8>>>>,
}

// An AsyncUdpSocket that copies every datagram flowing through the real socket into shared
// logs - the UDP analogue of the tap client's TapStream. Delegates all I/O to `inner`.
#[derive(Debug)]
struct TapUdpSocket {
    inner: Arc<dyn AsyncUdpSocket>,
    tap: DatagramTapHandles,
}

// Non-Clone handle bundle so TapUdpSocket can be Debug without the closures.
#[derive(Debug)]
struct DatagramTapHandles {
    datagrams_in: Arc<Mutex<Vec<Vec<u8>>>>,
    datagrams_out: Arc<Mutex<Vec<Vec<u8>>>>,
}

impl AsyncUdpSocket for TapUdpSocket {
    fn create_io_poller(self: Arc<Self>) -> Pin<Box<dyn UdpPoller>> {
        self.inner.clone().create_io_poller()
    }

    fn try_send(&self, transmit: &Transmit) -> io::Result<()> {
        let result = self.inner.try_send(transmit);
        if result.is_ok() {
            self.tap
                .datagrams_out
                .lock()
                .unwrap()
                .push(transmit.contents.to_vec());
        }
        result
    }

    fn poll_recv(
        &self,
        cx: &mut Context,
        bufs: &mut [IoSliceMut<'_>],
        meta: &mut [RecvMeta],
    ) -> Poll<io::Result<usize>> {
        let poll = self.inner.poll_recv(cx, bufs, meta);
        if let Poll::Ready(Ok(count)) = &poll {
            for index in 0..*count {
                let len = meta[index].len;
                self.tap
                    .datagrams_in
                    .lock()
                    .unwrap()
                    .push(bufs[index][..len].to_vec());
            }
        }
        poll
    }

    fn local_addr(&self) -> io::Result<SocketAddr> {
        self.inner.local_addr()
    }

    fn max_transmit_segments(&self) -> usize {
        self.inner.max_transmit_segments()
    }

    fn max_receive_segments(&self) -> usize {
        self.inner.max_receive_segments()
    }

    fn may_fragment(&self) -> bool {
        self.inner.may_fragment()
    }
}

// A rustls KeyLog that captures the SSLKEYLOGFILE-format secret lines (label, client-random,
// secret) QUIC needs to derive its Handshake/1-RTT packet keys for the dissection.
#[derive(Debug)]
struct KeyLogCapture {
    lines: Arc<Mutex<Vec<String>>>,
}

impl rustls::KeyLog for KeyLogCapture {
    fn log(&self, label: &str, client_random: &[u8], secret: &[u8]) {
        self.lines
            .lock()
            .unwrap()
            .push(format!("{label} {} {}", hex(client_random), hex(secret)));
    }

    fn will_log(&self, _label: &str) -> bool {
        true
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// The parsed target: TLS server name (host) + the resolved socket address + origin-form
// request URI.
struct QuicTarget {
    host: String,
    url: String,
}

fn parse_target(raw: &str) -> Result<QuicTarget, String> {
    let url = url::Url::parse(raw).map_err(|err| format!("Invalid URL: {err}"))?;
    if url.scheme() != "https" {
        return Err(format!(
            "HTTP/3 requires https, got scheme: {}",
            url.scheme()
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?
        .to_string();
    Ok(QuicTarget {
        host,
        url: raw.to_string(),
    })
}

fn tls_client_config(keylog: Arc<KeyLogCapture>) -> Result<rustls::ClientConfig, String> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    for extra in test_extra_roots() {
        let _ = roots.add(extra);
    }
    let mut config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    // QUIC mandates TLS 1.3.
    .with_protocol_versions(&[&rustls::version::TLS13])
    .map_err(|err| format!("Request failed: TLS 1.3 unavailable: {err}"))?
    .with_root_certificates(roots)
    .with_no_client_auth();
    config.alpn_protocols = vec![b"h3".to_vec()];
    config.key_log = keylog;
    Ok(config)
}

fn is_redirect(status: u16) -> bool {
    matches!(status, 301 | 302 | 303 | 307 | 308)
}

fn resolve_location(current: &str, location: &str) -> Result<String, String> {
    url::Url::parse(current)
        .map_err(|err| format!("Invalid base URL: {err}"))?
        .join(location)
        .map(|url| url.to_string())
        .map_err(|err| format!("Invalid redirect Location: {err}"))
}

// QUIC / HTTP-3 send path. Selected when a request's `httpVersion == "h3"`; mirrors
// `tap_client::send_via_tap`'s signature (same `HttpResponsePayload`, same `CancellationToken`
// + `__cancelled__` sentinel, four-phase timings) and returns the `QuicCapture` the dissector
// consumes. Timeout + cancellation are layered here; `drive` owns the request/redirect loop.
pub async fn send_via_quic(
    request: HttpRequestPayload,
    token: CancellationToken,
) -> Result<(HttpResponsePayload, QuicCapture), String> {
    let timeout = Duration::from_millis(request.timeout_ms);
    tokio::select! {
        biased;
        _ = token.cancelled() => Err(CANCEL_SENTINEL.to_string()),
        result = tokio::time::timeout(timeout, drive(request, token.clone())) => match result {
            Ok(inner) => inner,
            Err(_elapsed) => Err("Request failed: timed out".to_string()),
        },
    }
}

async fn drive(
    request: HttpRequestPayload,
    token: CancellationToken,
) -> Result<(HttpResponsePayload, QuicCapture), String> {
    let method = request.method.to_ascii_uppercase();
    let start = Instant::now();
    let mut current_url = request.url.clone();
    let mut current_method = method.clone();
    let mut current_body = request.body.clone();
    let mut dns_ms = 0u64;
    let mut connect_ms = 0u64;
    let mut waiting_ms = 0u64;
    let mut download_ms = 0u64;

    for _ in 0..=MAX_REDIRECTS {
        let target = parse_target(&current_url)?;
        let hop = tokio::select! {
            biased;
            _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
            result = one_hop(&target, &current_method, &request.headers, current_body.as_deref()) => result?,
        };
        dns_ms += hop.dns_ms;
        connect_ms += hop.connect_ms;
        waiting_ms += hop.waiting_ms;
        download_ms += hop.download_ms;

        if is_redirect(hop.status) {
            if let Some(location) = hop.location.as_deref() {
                current_url = resolve_location(&current_url, location)?;
                if hop.status == 303
                    || (matches!(hop.status, 301 | 302)
                        && current_method != "GET"
                        && current_method != "HEAD")
                {
                    current_method = "GET".to_string();
                    current_body = None;
                }
                continue;
            }
        }

        let size_bytes = hop.body.len();
        let time_ms = start.elapsed().as_millis() as u64;
        return Ok((
            HttpResponsePayload {
                status: hop.status,
                time_ms,
                size_bytes,
                body: hop.body,
                headers: hop.headers,
                timings: Some(ResponseTimings {
                    dns_ms,
                    connect_ms,
                    waiting_ms,
                    download_ms,
                }),
                dissection: None,
            },
            hop.capture,
        ));
    }

    Err("Request failed: too many redirects".to_string())
}

struct QuicHop {
    status: u16,
    headers: Vec<KeyValue>,
    body: String,
    location: Option<String>,
    capture: QuicCapture,
    dns_ms: u64,
    connect_ms: u64,
    waiting_ms: u64,
    download_ms: u64,
}

// One QUIC connection + HTTP/3 request/response round-trip. Resolves the host, dials each
// resolved address in turn (parity with the tap path's connect_any), and taps every datagram.
async fn one_hop(
    target: &QuicTarget,
    method: &str,
    headers: &[KeyValue],
    body: Option<&str>,
) -> Result<QuicHop, String> {
    let parsed = url::Url::parse(&target.url).map_err(|err| format!("Invalid URL: {err}"))?;
    let port = parsed.port_or_known_default().unwrap_or(443);

    let dns_start = Instant::now();
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((target.host.as_str(), port))
        .await
        .map_err(|err| format!("Request failed: DNS lookup failed: {err}"))?
        .collect();
    if addrs.is_empty() {
        return Err("Request failed: no addresses resolved".to_string());
    }
    let dns_ms = dns_start.elapsed().as_millis() as u64;

    // QUIC gives no fast connection-refused (unlike TCP), so a dead address would hang the
    // whole send. Bound every attempt but the last with a short probe so we fail over quickly
    // (happy-eyeballs-lite); the final address gets the remaining send budget (the outer
    // timeout in `send_via_quic` still caps the total).
    let mut last_err = "no addresses".to_string();
    let addr_count = addrs.len();
    // Wall-clock of the whole dial loop, so any failed-address probe time (a black-hole
    // address before the working one) folds into the successful hop's connect phase and the
    // four phases still partition the total.
    let dial_start = Instant::now();
    for (index, addr) in addrs.into_iter().enumerate() {
        let is_last = index + 1 == addr_count;
        let attempt = dial_and_request(addr, target, method, headers, body);
        let result = if is_last {
            attempt.await
        } else {
            match tokio::time::timeout(DIAL_PROBE_TIMEOUT, attempt).await {
                Ok(inner) => inner,
                Err(_elapsed) => Err(format!("Request failed: no h3 response from {addr}")),
            }
        };
        match result {
            Ok(mut hop) => {
                hop.dns_ms = dns_ms;
                // connect = every non-waiting, non-download ms since DNS resolved (this hop's
                // handshake plus any earlier dead-address probes).
                hop.connect_ms = (dial_start.elapsed().as_millis() as u64)
                    .saturating_sub(hop.waiting_ms + hop.download_ms);
                return Ok(hop);
            }
            Err(err) => last_err = err,
        }
    }
    Err(last_err)
}

// Per-address probe budget for all but the last resolved address, so a black-hole address
// (e.g. an IPv6 `localhost` with an IPv4-only listener) fails over fast instead of hanging.
const DIAL_PROBE_TIMEOUT: Duration = Duration::from_millis(2000);

async fn dial_and_request(
    addr: SocketAddr,
    target: &QuicTarget,
    method: &str,
    headers: &[KeyValue],
    body: Option<&str>,
) -> Result<QuicHop, String> {
    let keylog = Arc::new(KeyLogCapture {
        lines: Arc::new(Mutex::new(Vec::new())),
    });
    let tls = tls_client_config(keylog.clone())?;
    let quic_crypto = quinn::crypto::rustls::QuicClientConfig::try_from(tls)
        .map_err(|err| format!("Request failed: invalid QUIC client config: {err}"))?;
    let client_config = quinn::ClientConfig::new(Arc::new(quic_crypto));

    let tap = DatagramTap::default();
    let bind_addr = if addr.is_ipv6() { "[::]:0" } else { "0.0.0.0:0" };
    let std_socket = std::net::UdpSocket::bind(bind_addr)
        .map_err(|err| format!("Request failed: UDP bind failed: {err}"))?;
    let runtime = Arc::new(quinn::TokioRuntime);
    let wrapped = runtime
        .wrap_udp_socket(std_socket)
        .map_err(|err| format!("Request failed: socket wrap failed: {err}"))?;
    let tap_socket: Arc<dyn AsyncUdpSocket> = Arc::new(TapUdpSocket {
        inner: wrapped,
        tap: DatagramTapHandles {
            datagrams_in: tap.datagrams_in.clone(),
            datagrams_out: tap.datagrams_out.clone(),
        },
    });
    let mut endpoint = quinn::Endpoint::new_with_abstract_socket(
        quinn::EndpointConfig::default(),
        None,
        tap_socket,
        runtime,
    )
    .map_err(|err| format!("Request failed: endpoint init failed: {err}"))?;
    endpoint.set_default_client_config(client_config);

    let local_addr = endpoint.local_addr().ok();

    let connect_start = Instant::now();
    let connection = endpoint
        .connect(addr, &target.host)
        .map_err(|err| format!("Request failed: connect setup failed: {err}"))?
        .await
        .map_err(|err| format!("Request failed: QUIC handshake failed: {err}"))?;
    let connect_ms = connect_start.elapsed().as_millis() as u64;

    let alpn = connection
        .handshake_data()
        .and_then(|data| data.downcast::<quinn::crypto::rustls::HandshakeData>().ok())
        .and_then(|data| data.protocol.clone())
        .map(|protocol| String::from_utf8_lossy(&protocol).into_owned());

    let (mut h3_driver, mut send_request) =
        h3::client::new(h3_quinn::Connection::new(connection))
            .await
            .map_err(|err| format!("Request failed: HTTP/3 handshake failed: {err}"))?;
    let driver = tokio::spawn(async move { poll_fn(|cx| h3_driver.poll_close(cx)).await });

    let waiting_start = Instant::now();
    let http_method = http::Method::from_bytes(method.as_bytes())
        .map_err(|err| format!("Invalid method: {err}"))?;
    let mut builder = http::Request::builder().method(http_method).uri(&target.url);
    for header in headers {
        if header.key.eq_ignore_ascii_case("host") {
            continue;
        }
        builder = builder.header(header.key.as_str(), header.value.as_str());
    }
    let req = builder
        .body(())
        .map_err(|err| format!("Failed to build request: {err}"))?;

    let mut stream = send_request
        .send_request(req)
        .await
        .map_err(|err| format!("Request failed: {err}"))?;
    if let Some(body) = body {
        stream
            .send_data(Bytes::from(body.to_owned()))
            .await
            .map_err(|err| format!("Request failed: sending body: {err}"))?;
    }
    stream
        .finish()
        .await
        .map_err(|err| format!("Request failed: finishing request: {err}"))?;

    let response = stream
        .recv_response()
        .await
        .map_err(|err| format!("Request failed: {err}"))?;
    let waiting_ms = waiting_start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let headers_out: Vec<KeyValue> = response
        .headers()
        .iter()
        .map(|(name, value)| KeyValue {
            key: name.to_string(),
            value: value.to_str().unwrap_or_default().to_string(),
        })
        .collect();
    let location = headers_out
        .iter()
        .find(|kv| kv.key.eq_ignore_ascii_case("location"))
        .map(|kv| kv.value.clone());

    let download_start = Instant::now();
    let mut body_bytes = Vec::new();
    while let Some(mut chunk) = stream
        .recv_data()
        .await
        .map_err(|err| format!("Failed to read response body: {err}"))?
    {
        let remaining = chunk.remaining();
        body_bytes.extend_from_slice(&chunk.copy_to_bytes(remaining));
    }
    let download_ms = download_start.elapsed().as_millis() as u64;

    let peer_addr = Some(addr);
    endpoint.close(0u32.into(), b"done");
    driver.abort();

    let datagrams_out = std::mem::take(&mut *tap.datagrams_out.lock().unwrap());
    let datagrams_in = std::mem::take(&mut *tap.datagrams_in.lock().unwrap());
    // The client's first outbound datagram is a long-header Initial packet whose bytes 1..5
    // carry the negotiated QUIC version.
    let quic_version = datagrams_out
        .first()
        .filter(|datagram| datagram.len() >= 5 && datagram[0] & 0x80 != 0)
        .map(|datagram| u32::from_be_bytes([datagram[1], datagram[2], datagram[3], datagram[4]]));
    let keylog = std::mem::take(&mut *keylog.lines.lock().unwrap());

    Ok(QuicHop {
        status,
        headers: headers_out,
        body: String::from_utf8_lossy(&body_bytes).into_owned(),
        location,
        capture: QuicCapture {
            peer_addr,
            local_addr,
            quic_version,
            alpn,
            tls_cipher: None,
            datagrams_in,
            datagrams_out,
            keylog,
        },
        dns_ms: 0,
        connect_ms,
        waiting_ms,
        download_ms,
    })
}

// Test-only trust seam: extra DER roots the loopback h3 test server registers so the client's
// `tls_client_config` trusts its self-signed cert. Mirrors `tap_client`'s seam. Empty in
// production (never set outside tests).
#[cfg(test)]
static TEST_EXTRA_ROOTS: Mutex<Vec<rustls::pki_types::CertificateDer<'static>>> =
    Mutex::new(Vec::new());

#[cfg(test)]
fn test_extra_roots() -> Vec<rustls::pki_types::CertificateDer<'static>> {
    TEST_EXTRA_ROOTS.lock().unwrap().clone()
}

#[cfg(not(test))]
fn test_extra_roots() -> Vec<rustls::pki_types::CertificateDer<'static>> {
    Vec::new()
}

#[cfg(test)]
mod quic_tests {
    use super::*;
    use crate::KeyValue;
    use bytes::{Buf, Bytes};
    use hyper::http;
    use std::sync::Arc;
    use std::time::Duration;

    // The crate cancel sentinel is `CANCEL_SENTINEL` in lib.rs (private), so the literal is
    // hardcoded here. Keep in sync with lib.rs.
    const CANCEL_SENTINEL: &str = "__cancelled__";

    fn get_request(url: &str, request_id: &str) -> HttpRequestPayload {
        HttpRequestPayload {
            method: "GET".to_string(),
            url: url.to_string(),
            headers: vec![],
            body: None,
            timeout_ms: 5000,
            http_version: "h3".to_string(),
            request_id: request_id.to_string(),
        }
    }

    // TC-001 -> AC-001 - behavior: an h3 GET against a loopback QUIC/HTTP-3 server that replies
    // 200 + body "h3-ok" + header `x-proto: h3` returns exactly that status, body, and header.
    #[tokio::test]
    async fn should_return_200_body_and_custom_header_if_h3_get_succeeds() {
        let addr = spawn_loopback_h3_server(Duration::ZERO).await;

        let (response, _capture) = send_via_quic(
            get_request(&format!("https://localhost:{}/", addr.port()), "quic-ok"),
            CancellationToken::new(),
        )
        .await
        .expect("h3 send should succeed against the loopback server");

        assert_eq!(response.status, 200);
        assert_eq!(response.body, "h3-ok");
        assert!(
            response
                .headers
                .iter()
                .any(|header| header.key.eq_ignore_ascii_case("x-proto") && header.value == "h3"),
            "the h3 response header x-proto: h3 should be present"
        );
    }

    // TC-002 -> AC-001 - side-effect-contract: a POST with a body and a custom request header
    // round-trips. The loopback server replies 200 "echoed" ONLY when it received both the exact
    // body and the header, so a 200 proves both reached the server over QUIC.
    #[tokio::test]
    async fn should_round_trip_body_and_custom_header_if_h3_post_sent() {
        let addr = spawn_loopback_h3_server(Duration::ZERO).await;

        let request = HttpRequestPayload {
            method: "POST".to_string(),
            url: format!("https://localhost:{}/echo", addr.port()),
            headers: vec![KeyValue {
                key: "x-custom".to_string(),
                value: "custom-val".to_string(),
            }],
            body: Some("payload-123".to_string()),
            timeout_ms: 5000,
            http_version: "h3".to_string(),
            request_id: "quic-post".to_string(),
        };

        let (response, _capture) = send_via_quic(request, CancellationToken::new())
            .await
            .expect("h3 post should succeed");

        assert_eq!(response.status, 200);
        assert_eq!(response.body, "echoed");
    }

    // TC-003(a) -> AC-005 - behavior: a server that delays its response past a small `timeout_ms`
    // makes `send_via_quic` return Err (never hangs past the timeout).
    #[tokio::test]
    async fn should_return_err_if_the_h3_server_delays_past_the_timeout() {
        let addr = spawn_loopback_h3_server(Duration::from_secs(3)).await;

        let mut request = get_request(&format!("https://localhost:{}/", addr.port()), "quic-timeout");
        request.timeout_ms = 300;

        let result = send_via_quic(request, CancellationToken::new()).await;

        assert!(result.is_err(), "an h3 send past timeout_ms must return Err");
    }

    // TC-003(b) -> AC-005 - behavior: a concurrent `token.cancel()` during an in-flight (hanging)
    // h3 send makes `send_via_quic` resolve to Err equal to the crate cancel sentinel.
    #[tokio::test]
    async fn should_resolve_to_the_cancel_sentinel_if_cancelled_mid_flight() {
        let addr = spawn_loopback_h3_server(Duration::from_secs(30)).await;

        let token = CancellationToken::new();
        let request = get_request(&format!("https://localhost:{}/", addr.port()), "quic-cancel");
        let send = tokio::spawn(send_via_quic(request, token.clone()));

        tokio::time::sleep(Duration::from_millis(50)).await;
        token.cancel();

        let result = send.await.expect("the send task should not panic");
        match result {
            Err(error) => assert_eq!(error, CANCEL_SENTINEL),
            Ok(_) => panic!("a cancelled send must not resolve to Ok"),
        }
    }

    // TC-004 -> AC-006 - behavior: an h3 send to a closed UDP port returns Err and never hangs.
    // Wrapped in a generous outer timeout so a hang (rather than a bounded transport Err) fails
    // the test instead of blocking the suite.
    #[tokio::test]
    async fn should_return_err_and_not_hang_if_the_udp_port_is_closed() {
        let mut request = get_request("https://127.0.0.1:1/", "quic-closed");
        request.timeout_ms = 1000;

        let outcome = tokio::time::timeout(
            Duration::from_secs(10),
            send_via_quic(request, CancellationToken::new()),
        )
        .await;

        let result = outcome.expect("an h3 send to a closed UDP port must not hang past the guard");
        assert!(result.is_err(), "an h3 send to a closed UDP port must be a transport Err");
    }

    // TC-005 -> AC-007 - behavior: a successful h3 send carries a `timings` object whose four
    // phases partition the total (sum <= time_ms, and >= time_ms minus a small rounding gap),
    // like the tap path.
    #[tokio::test]
    async fn should_return_timings_that_partition_the_total_if_the_h3_send_succeeds() {
        let addr = spawn_loopback_h3_server(Duration::ZERO).await;

        let (response, _capture) = send_via_quic(
            get_request(&format!("https://localhost:{}/", addr.port()), "quic-timings"),
            CancellationToken::new(),
        )
        .await
        .expect("h3 send should succeed");

        let timings = response
            .timings
            .expect("a successful h3 send should carry timings");
        let sum = timings.dns_ms + timings.connect_ms + timings.waiting_ms + timings.download_ms;
        assert!(
            sum <= response.time_ms,
            "phases {sum} must not exceed total {}",
            response.time_ms
        );
        assert!(
            sum >= response.time_ms.saturating_sub(8),
            "phases {sum} must be within a rounding gap of total {}",
            response.time_ms
        );
    }

    // TC-006 -> AC-002: routing (`httpVersion == "auto"` must NOT enter `send_via_quic`) lives in
    // lib.rs's `send_http_request`, so it is unobservable from this module. It is verified by the
    // lib.rs routing change plus the existing "auto"-path tests staying green (tap_client::tap_tests
    // + lib.rs `should_deserialize_http_version_h3_when_present_and_default_auto_when_absent`, which
    // pins that an absent/`"auto"` payload defaults to the tap path). No weak test is invented here.

    // AC-001/006/007 over a REAL public HTTP/3 endpoint using the production webpki trust roots
    // (the loopback tests bypass those via the test-root seam). Ignored by default so offline/CI
    // runs never flake; run explicitly with `cargo test -- --ignored real_h3`.
    #[tokio::test]
    #[ignore = "network: hits https://cloudflare-quic.com; run with --ignored real_h3"]
    async fn should_complete_a_real_h3_send_against_the_public_trust_roots() {
        let (response, capture) = send_via_quic(
            get_request("https://cloudflare-quic.com/", "quic-real-h3"),
            CancellationToken::new(),
        )
        .await
        .expect("a real h3 send should succeed against the public trust roots");

        assert_eq!(response.status, 200);
        assert_eq!(capture.alpn.as_deref(), Some("h3"));
        assert!(capture.quic_version.is_some());
        assert!(!capture.datagrams_in.is_empty());
    }

    // Loopback QUIC/HTTP-3 server offering ALPN `h3` with an rcgen self-signed cert, registered
    // into the client's test trust seam so the handshake succeeds. Replies to a GET with 200 +
    // body "h3-ok" + header `x-proto: h3`; to a POST it replies 200 "echoed" only when it received
    // both body "payload-123" and header `x-custom: custom-val` (else 422). `response_delay` (if
    // non-zero) is applied after reading the request and before responding, to exercise the
    // timeout/cancellation paths.
    async fn spawn_loopback_h3_server(response_delay: Duration) -> SocketAddr {
        let certified = rcgen::generate_simple_self_signed(vec!["localhost".to_string()])
            .expect("generate self-signed cert");
        let cert_der = certified.cert.der().clone();
        TEST_EXTRA_ROOTS.lock().unwrap().push(cert_der.clone());
        let key_der =
            rustls::pki_types::PrivateKeyDer::Pkcs8(certified.key_pair.serialize_der().into());

        let mut tls_config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_protocol_versions(&[&rustls::version::TLS13])
        .expect("tls13 supported by the ring provider")
        .with_no_client_auth()
        .with_single_cert(vec![cert_der], key_der)
        .expect("server single cert");
        tls_config.alpn_protocols = vec![b"h3".to_vec()];
        tls_config.max_early_data_size = u32::MAX;

        let quic_server_config = quinn::crypto::rustls::QuicServerConfig::try_from(tls_config)
            .expect("quic server config from rustls server config");
        let server_config = quinn::ServerConfig::with_crypto(Arc::new(quic_server_config));

        let endpoint = quinn::Endpoint::server(server_config, "127.0.0.1:0".parse().unwrap())
            .expect("bind loopback quic endpoint");
        let addr = endpoint.local_addr().expect("endpoint local addr");

        tokio::spawn(async move {
            while let Some(incoming) = endpoint.accept().await {
                tokio::spawn(async move {
                    let Ok(conn) = incoming.await else {
                        return;
                    };
                    let quinn_conn = h3_quinn::Connection::new(conn);
                    let mut h3_conn: h3::server::Connection<h3_quinn::Connection, Bytes> =
                        match h3::server::Connection::new(quinn_conn).await {
                            Ok(conn) => conn,
                            Err(_) => return,
                        };
                    while let Ok(Some(resolver)) = h3_conn.accept().await {
                        tokio::spawn(async move {
                            let Ok((req, mut stream)) = resolver.resolve_request().await else {
                                return;
                            };
                            let mut body = Vec::new();
                            while let Ok(Some(mut chunk)) = stream.recv_data().await {
                                let remaining = chunk.remaining();
                                let bytes = chunk.copy_to_bytes(remaining);
                                body.extend_from_slice(&bytes);
                            }

                            if !response_delay.is_zero() {
                                tokio::time::sleep(response_delay).await;
                            }

                            let x_custom = req
                                .headers()
                                .get("x-custom")
                                .and_then(|value| value.to_str().ok())
                                .map(str::to_string);
                            let is_post = req.method() == http::Method::POST;
                            let (status, reply_body): (u16, &[u8]) = match is_post {
                                true if body == b"payload-123"
                                    && x_custom.as_deref() == Some("custom-val") =>
                                {
                                    (200, b"echoed")
                                }
                                true => (422, b"missing"),
                                false => (200, b"h3-ok"),
                            };

                            let response = http::Response::builder()
                                .status(status)
                                .header("x-proto", "h3")
                                .body(())
                                .expect("build h3 response");
                            let _ = stream.send_response(response).await;
                            let _ = stream.send_data(Bytes::copy_from_slice(reply_body)).await;
                            let _ = stream.finish().await;
                        });
                    }
                });
            }
        });

        addr
    }
}
