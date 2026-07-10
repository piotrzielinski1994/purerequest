use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::{Request, Response};
use hyper_util::rt::{TokioExecutor, TokioIo};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio_util::sync::CancellationToken;

use crate::{HttpRequestPayload, HttpResponsePayload, KeyValue, ResponseTimings};

const CANCEL_SENTINEL: &str = "__cancelled__";
const MAX_REDIRECTS: usize = 10;

// Byte-level tap of one send. Populated on the hand-rolled send path; the raw/decrypted
// byte logs and negotiated TLS params are the seams the later dissection sub-tasks decode.
// Fields are captured now but not yet consumed - sub-tasks 2-5 read them into the dissection
// model + Protocols UI.
#[allow(dead_code)]
#[derive(Debug, Default, Clone)]
pub struct Capture {
    pub peer_addr: Option<SocketAddr>,
    pub local_addr: Option<SocketAddr>,
    pub alpn: Option<String>,
    pub tls_version: Option<String>,
    pub tls_cipher: Option<String>,
    pub tls_records_in: Vec<u8>,
    pub tls_records_out: Vec<u8>,
    pub app_data_in: Vec<u8>,
    pub app_data_out: Vec<u8>,
}

// Shared byte buffers a TapStream appends to. Two per send: one below rustls (raw TLS
// records / plaintext HTTP for http://), one above rustls (decrypted app-data).
#[derive(Clone, Default)]
struct TapBuffers {
    read_log: Arc<Mutex<Vec<u8>>>,
    write_log: Arc<Mutex<Vec<u8>>>,
}

impl TapBuffers {
    fn take(&self) -> (Vec<u8>, Vec<u8>) {
        let read = std::mem::take(&mut *self.read_log.lock().unwrap());
        let write = std::mem::take(&mut *self.write_log.lock().unwrap());
        (read, write)
    }
}

// An AsyncRead/AsyncWrite wrapper that copies every byte flowing through into shared logs.
// Wrapping the TcpStream logs the raw TLS records (or plaintext HTTP); wrapping the
// TlsStream logs the decrypted application data.
struct TapStream<S> {
    inner: S,
    buffers: TapBuffers,
}

impl<S> TapStream<S> {
    fn new(inner: S, buffers: TapBuffers) -> Self {
        Self { inner, buffers }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for TapStream<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let before = buf.filled().len();
        let poll = Pin::new(&mut self.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = &poll {
            let new = &buf.filled()[before..];
            if !new.is_empty() {
                self.buffers.read_log.lock().unwrap().extend_from_slice(new);
            }
        }
        poll
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for TapStream<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let poll = Pin::new(&mut self.inner).poll_write(cx, buf);
        if let Poll::Ready(Ok(written)) = &poll {
            self.buffers
                .write_log
                .lock()
                .unwrap()
                .extend_from_slice(&buf[..*written]);
        }
        poll
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

// A parsed target: scheme, host, port, and the origin-form path+query for the request line.
struct Target {
    is_tls: bool,
    host: String,
    port: u16,
    path_and_query: String,
}

fn parse_target(raw: &str) -> Result<Target, String> {
    let url = url::Url::parse(raw).map_err(|err| format!("Invalid URL: {err}"))?;
    let scheme = url.scheme();
    let is_tls = match scheme {
        "https" => true,
        "http" => false,
        other => return Err(format!("Unsupported URL scheme: {other}")),
    };
    let host = url
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?
        .to_string();
    let port = url.port_or_known_default().unwrap_or(if is_tls { 443 } else { 80 });
    let path_and_query = match url.query() {
        Some(query) => format!("{}?{}", url.path(), query),
        None => url.path().to_string(),
    };
    Ok(Target {
        is_tls,
        host,
        port,
        path_and_query,
    })
}

// The decoded outcome of one round-trip, before redirect handling. Carries the phase spans
// measured at their true boundaries inside the hop (connect = TCP+TLS handshake only, waiting
// = request write -> response headers, download = body read), so the caller can partition the
// total the same way the reqwest path does instead of lumping the whole hop into "connect".
struct Hop {
    status: u16,
    headers: Vec<KeyValue>,
    body: Bytes,
    location: Option<String>,
    capture: Capture,
    connect_ms: u64,
    waiting_ms: u64,
    download_ms: u64,
}

fn header_value<'a>(headers: &'a [KeyValue], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|kv| kv.key.eq_ignore_ascii_case(name))
        .map(|kv| kv.value.as_str())
}

fn decode_body(body: &[u8], encoding: Option<&str>) -> Result<String, String> {
    use std::io::Read;
    let decoded: Vec<u8> = match encoding.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("gzip") | Some("x-gzip") => {
            let mut out = Vec::new();
            flate2::read::GzDecoder::new(body)
                .read_to_end(&mut out)
                .map_err(|err| format!("Failed to gunzip response: {err}"))?;
            out
        }
        Some("deflate") => {
            let mut out = Vec::new();
            flate2::read::ZlibDecoder::new(body)
                .read_to_end(&mut out)
                .map_err(|err| format!("Failed to inflate response: {err}"))?;
            out
        }
        Some("br") => {
            let mut out = Vec::new();
            brotli::Decompressor::new(body, 4096)
                .read_to_end(&mut out)
                .map_err(|err| format!("Failed to brotli-decode response: {err}"))?;
            out
        }
        _ => body.to_vec(),
    };
    Ok(String::from_utf8_lossy(&decoded).into_owned())
}

// Redirect status -> whether the method/body is preserved (307/308) or rewritten to GET.
fn is_redirect(status: u16) -> bool {
    matches!(status, 301 | 302 | 303 | 307 | 308)
}

// Resolve a Location (absolute or relative) against the current absolute URL.
fn resolve_location(current: &str, location: &str) -> Result<String, String> {
    let base = url::Url::parse(current).map_err(|err| format!("Invalid base URL: {err}"))?;
    base
        .join(location)
        .map(|u| u.to_string())
        .map_err(|err| format!("Invalid redirect Location: {err}"))
}

pub async fn send_via_tap(
    request: HttpRequestPayload,
    token: CancellationToken,
) -> Result<(HttpResponsePayload, Capture), String> {
    let timeout = Duration::from_millis(request.timeout_ms);
    let overall = tokio::select! {
        biased;
        _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
        result = tokio::time::timeout(timeout, drive(request, token.clone())) => result,
    };
    match overall {
        Ok(inner) => inner,
        Err(_elapsed) => Err("Request failed: timed out".to_string()),
    }
}

// Runs the request + redirect loop; timing + cancellation are layered by send_via_tap.
async fn drive(
    request: HttpRequestPayload,
    token: CancellationToken,
) -> Result<(HttpResponsePayload, Capture), String> {
    let method = request.method.to_ascii_uppercase();
    let start = Instant::now();
    let mut current_url = request.url.clone();
    let mut current_method = method.clone();
    let mut current_body = request.body.clone();
    // Phase spans accumulate across redirect hops so the reported breakdown covers the whole
    // chain (each phase measured at its true boundary inside the hop, mirroring reqwest).
    let mut dns_ms = 0u64;
    let mut connect_ms = 0u64;
    let mut waiting_ms = 0u64;
    let mut download_ms = 0u64;

    for _ in 0..=MAX_REDIRECTS {
        let target = parse_target(&current_url)?;

        // DNS (timed) -> all resolved addresses (the connect tries each in turn).
        let dns_start = Instant::now();
        let addrs: Vec<SocketAddr> = tokio::select! {
            biased;
            _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
            resolved = tokio::net::lookup_host((target.host.as_str(), target.port)) => resolved
                .map_err(|err| format!("Request failed: DNS lookup failed: {err}"))?
                .collect(),
        };
        if addrs.is_empty() {
            return Err("Request failed: no addresses resolved".to_string());
        }
        dns_ms += dns_start.elapsed().as_millis() as u64;

        let hop = tokio::select! {
            biased;
            _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
            result = one_hop(&target, &addrs, &current_method, &request.headers, current_body.as_deref(), &token) => result?,
        };
        connect_ms += hop.connect_ms;
        waiting_ms += hop.waiting_ms;
        download_ms += hop.download_ms;

        if is_redirect(hop.status) {
            if let Some(location) = hop.location.as_deref() {
                current_url = resolve_location(&current_url, location)?;
                // 303 (and 301/302 for non-GET/HEAD by common practice) -> GET, drop body.
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

        // Final response: decode the body (download span already timed inside the hop; the
        // decompression cost folds into download too).
        let encoding = header_value(&hop.headers, "content-encoding").map(str::to_string);
        let decode_start = Instant::now();
        let body = decode_body(&hop.body, encoding.as_deref())?;
        download_ms += decode_start.elapsed().as_millis() as u64;
        let size_bytes = body.len();
        let time_ms = start.elapsed().as_millis() as u64;
        let timings = ResponseTimings {
            dns_ms,
            connect_ms,
            waiting_ms,
            download_ms,
        };

        return Ok((
            HttpResponsePayload {
                status: hop.status,
                time_ms,
                size_bytes,
                body,
                headers: hop.headers,
                timings: Some(timings),
                // Dissection is attached by the caller (`send_http_request`) from the returned
                // capture, so the tap client stays free of the decoder dependency.
                dissection: None,
            },
            hop.capture,
        ));
    }

    Err("Request failed: too many redirects".to_string())
}

// Connect to the first address that accepts (parity with reqwest, which walks the resolved
// address list so an IPv6-first `localhost` still reaches an IPv4-only listener).
async fn connect_any(addrs: &[SocketAddr]) -> Result<TcpStream, String> {
    let mut last_err = None;
    for addr in addrs {
        match TcpStream::connect(addr).await {
            Ok(stream) => return Ok(stream),
            Err(err) => last_err = Some(err),
        }
    }
    Err(format!(
        "Request failed: connect failed: {}",
        last_err
            .map(|err| err.to_string())
            .unwrap_or_else(|| "no addresses".to_string())
    ))
}

// One TCP+TLS connect and request/response round-trip. Body is buffered whole (parity with
// reqwest's `.text()`), which also gives the download phase a clean span.
async fn one_hop(
    target: &Target,
    addrs: &[SocketAddr],
    method: &str,
    headers: &[KeyValue],
    body: Option<&str>,
    token: &CancellationToken,
) -> Result<Hop, String> {
    // Connect span = TCP connect (+ TLS handshake, added below for https).
    let connect_start = Instant::now();
    let tcp = tokio::select! {
        biased;
        _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
        result = connect_any(addrs) => result?,
    };
    let peer_addr = tcp.peer_addr().ok();
    let local_addr = tcp.local_addr().ok();
    let raw_buffers = TapBuffers::default();
    let tapped_tcp = TapStream::new(tcp, raw_buffers.clone());

    let http_method = hyper::Method::from_bytes(method.as_bytes())
        .map_err(|err| format!("Invalid method: {err}"))?;

    if target.is_tls {
        run_tls_hop(
            target,
            tapped_tcp,
            raw_buffers,
            peer_addr,
            local_addr,
            http_method,
            headers,
            body,
            token,
            connect_start,
        )
        .await
    } else {
        let capture = Capture {
            peer_addr,
            local_addr,
            ..Default::default()
        };
        let connect_ms = connect_start.elapsed().as_millis() as u64;
        // For http:// the "raw" tap already holds the plaintext HTTP bytes; no app-data tap.
        run_hop_over(tapped_tcp, false, raw_buffers, capture, target, http_method, headers, body, token, connect_ms)
            .await
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_tls_hop<S>(
    target: &Target,
    tapped_tcp: S,
    raw_buffers: TapBuffers,
    peer_addr: Option<SocketAddr>,
    local_addr: Option<SocketAddr>,
    method: hyper::Method,
    headers: &[KeyValue],
    body: Option<&str>,
    token: &CancellationToken,
    connect_start: Instant,
) -> Result<Hop, String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let connector = tokio_rustls::TlsConnector::from(tls_client_config());
    let server_name = rustls::pki_types::ServerName::try_from(target.host.clone())
        .map_err(|err| format!("Request failed: invalid TLS server name: {err}"))?;
    let tls = tokio::select! {
        biased;
        _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
        result = connector.connect(server_name, tapped_tcp) => result
            .map_err(|err| format!("Request failed: TLS handshake failed: {err}"))?,
    };
    // Connect span closes once TLS is established (TCP connect + handshake).
    let connect_ms = connect_start.elapsed().as_millis() as u64;

    let (alpn, tls_version, tls_cipher) = {
        let (_io, conn) = tls.get_ref();
        (
            conn.alpn_protocol().map(|p| String::from_utf8_lossy(p).into_owned()),
            conn.protocol_version().map(|v| format!("{v:?}")),
            conn
                .negotiated_cipher_suite()
                .map(|s| format!("{:?}", s.suite())),
        )
    };
    let is_h2 = alpn.as_deref() == Some("h2");
    let capture = Capture {
        peer_addr,
        local_addr,
        alpn,
        tls_version,
        tls_cipher,
        ..Default::default()
    };

    let app_buffers = TapBuffers::default();
    let tapped_tls = TapStream::new(tls, app_buffers.clone());
    let mut hop = run_hop_over(
        tapped_tls, is_h2, app_buffers, capture, target, method, headers, body, token, connect_ms,
    )
    .await?;
    // Fold the raw TLS record log (below rustls) into the returned capture.
    let (records_in, records_out) = raw_buffers.take();
    hop.capture.tls_records_in = records_in;
    hop.capture.tls_records_out = records_out;
    Ok(hop)
}

// Drives hyper (http1 or http2) over an already-established, tapped byte stream, buffers the
// body, and folds the app-data tap into the capture.
#[allow(clippy::too_many_arguments)]
async fn run_hop_over<S>(
    stream: S,
    is_h2: bool,
    app_buffers: TapBuffers,
    mut capture: Capture,
    target: &Target,
    method: hyper::Method,
    headers: &[KeyValue],
    body: Option<&str>,
    token: &CancellationToken,
    connect_ms: u64,
) -> Result<Hop, String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let io = TokioIo::new(stream);
    let req = build_request(target, method, headers, body)?;

    // Waiting span = HTTP handshake + request write -> response headers arrive (TTFB).
    let waiting_start = Instant::now();
    let response: Response<Incoming> = if is_h2 {
        let (mut sender, conn) = hyper::client::conn::http2::handshake(TokioExecutor::new(), io)
            .await
            .map_err(|err| format!("Request failed: HTTP/2 handshake failed: {err}"))?;
        tokio::spawn(async move {
            let _ = conn.await;
        });
        tokio::select! {
            biased;
            _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
            result = sender.send_request(req) => result
                .map_err(|err| format!("Request failed: {err}"))?,
        }
    } else {
        let (mut sender, conn) = hyper::client::conn::http1::handshake(io)
            .await
            .map_err(|err| format!("Request failed: HTTP/1 handshake failed: {err}"))?;
        tokio::spawn(async move {
            let _ = conn.await;
        });
        tokio::select! {
            biased;
            _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
            result = sender.send_request(req) => result
                .map_err(|err| format!("Request failed: {err}"))?,
        }
    };

    let waiting_ms = waiting_start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let response_headers: Vec<KeyValue> = response
        .headers()
        .iter()
        .map(|(name, value)| KeyValue {
            key: name.to_string(),
            value: value.to_str().unwrap_or_default().to_string(),
        })
        .collect();
    let location = header_value(&response_headers, "location").map(str::to_string);

    // Download span = reading the body bytes off the wire (decompression is timed by the caller).
    let download_start = Instant::now();
    let collected = tokio::select! {
        biased;
        _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
        result = response.into_body().collect() => result
            .map_err(|err| format!("Failed to read response body: {err}"))?,
    };
    let download_ms = download_start.elapsed().as_millis() as u64;
    let body_bytes = collected.to_bytes();

    let (app_in, app_out) = app_buffers.take();
    capture.app_data_in = app_in;
    capture.app_data_out = app_out;

    Ok(Hop {
        status,
        headers: response_headers,
        body: body_bytes,
        location,
        capture,
        connect_ms,
        waiting_ms,
        download_ms,
    })
}

fn build_request(
    target: &Target,
    method: hyper::Method,
    headers: &[KeyValue],
    body: Option<&str>,
) -> Result<Request<Full<Bytes>>, String> {
    let authority = if (target.is_tls && target.port == 443) || (!target.is_tls && target.port == 80)
    {
        target.host.clone()
    } else {
        format!("{}:{}", target.host, target.port)
    };
    let mut builder = Request::builder()
        .method(method)
        .uri(&target.path_and_query)
        .header(hyper::header::HOST, &authority);
    for header in headers {
        if header.key.eq_ignore_ascii_case("host") {
            continue;
        }
        builder = builder.header(header.key.as_str(), header.value.as_str());
    }
    let payload = body.map(|b| Bytes::from(b.to_owned())).unwrap_or_default();
    builder
        .body(Full::new(payload))
        .map_err(|err| format!("Failed to build request: {err}"))
}

fn tls_client_config() -> Arc<rustls::ClientConfig> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    for extra in test_extra_roots() {
        let _ = roots.add(extra);
    }
    let mut config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .expect("safe default protocol versions")
    .with_root_certificates(roots)
    .with_no_client_auth();
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    Arc::new(config)
}

// Test-only trust seam: extra DER roots the loopback TLS test server can register so the
// client trusts its self-signed cert. Empty in production (never set outside tests).
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
mod tap_tests {
    use super::*;
    use crate::KeyValue;
    use std::time::Duration;
    use wiremock::matchers::{body_string, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    // The crate cancel sentinel is `CANCEL_SENTINEL` in lib.rs (private), so the
    // literal is hardcoded here. Keep in sync with lib.rs.
    const CANCEL_SENTINEL: &str = "__cancelled__";

    fn get_request(url: &str, request_id: &str) -> HttpRequestPayload {
        HttpRequestPayload {
            method: "GET".to_string(),
            url: url.to_string(),
            headers: vec![],
            body: None,
            timeout_ms: 5000,
            request_id: request_id.to_string(),
        }
    }

    // TC-001 -> AC-001, AC-009 - behavior: a successful GET returns status 200, the
    // expected body text, the echoed custom header, sizeBytes == body.len(), and a
    // timings object whose four phases partition the total (sum <= time_ms, and >=
    // time_ms minus a small rounding gap). Uses plaintext http (wiremock); the observable
    // result shape is identical to the https path (which the TLS tests below exercise).
    #[tokio::test]
    async fn should_return_200_body_headers_and_partitioned_timings_if_get_succeeds() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/ok"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("x-live", "yes")
                    .set_body_string("{\"ok\":true}"),
            )
            .mount(&server)
            .await;

        let (response, _capture) =
            send_via_tap(get_request(&format!("{}/ok", server.uri()), "tap-ok"), CancellationToken::new())
                .await
                .expect("send should succeed");

        assert_eq!(response.status, 200);
        assert_eq!(response.body, "{\"ok\":true}");
        assert_eq!(response.size_bytes, response.body.len());
        assert!(response
            .headers
            .iter()
            .any(|header| header.key.eq_ignore_ascii_case("x-live") && header.value == "yes"));

        let timings = response.timings.expect("a successful send should carry timings");
        let sum = timings.dns_ms + timings.connect_ms + timings.waiting_ms + timings.download_ms;
        assert!(sum <= response.time_ms, "phases {sum} must not exceed total {}", response.time_ms);
        assert!(
            sum >= response.time_ms.saturating_sub(8),
            "phases {sum} must be within a rounding gap of total {}",
            response.time_ms
        );
    }

    // TC-002 -> AC-002 - side-effect-contract: a POST with a body and a custom request
    // header round-trips. The mock only matches when the request carried both, so a
    // 200 (not wiremock's 404-on-no-match) proves the body + header reached the server.
    #[tokio::test]
    async fn should_round_trip_body_and_custom_header_if_post_sent() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/echo"))
            .and(body_string("payload-123"))
            .and(header("x-custom", "custom-val"))
            .respond_with(ResponseTemplate::new(200).set_body_string("echoed"))
            .mount(&server)
            .await;

        let request = HttpRequestPayload {
            method: "POST".to_string(),
            url: format!("{}/echo", server.uri()),
            headers: vec![KeyValue {
                key: "x-custom".to_string(),
                value: "custom-val".to_string(),
            }],
            body: Some("payload-123".to_string()),
            timeout_ms: 5000,
            request_id: "tap-post".to_string(),
        };

        let (response, _capture) = send_via_tap(request, CancellationToken::new())
            .await
            .expect("post should succeed");

        assert_eq!(response.status, 200);
        assert_eq!(response.body, "echoed");
    }

    // TC-003 -> AC-003 - behavior: a plaintext `http://` GET returns 200 and a body,
    // with no TLS layer involved.
    #[tokio::test]
    async fn should_return_200_and_body_if_plaintext_http_get() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/plain"))
            .respond_with(ResponseTemplate::new(200).set_body_string("plaintext-ok"))
            .mount(&server)
            .await;

        let (response, _capture) =
            send_via_tap(get_request(&format!("{}/plain", server.uri()), "tap-plain"), CancellationToken::new())
                .await
                .expect("plaintext send should succeed");

        assert_eq!(response.status, 200);
        assert_eq!(response.body, "plaintext-ok");
    }

    // TC-004 -> AC-004 - behavior: a 302 with a `Location` to a second path is followed
    // to the final 200 body.
    #[tokio::test]
    async fn should_follow_a_302_redirect_to_the_final_200_body() {
        let server = MockServer::start().await;
        let base = server.uri();
        Mock::given(method("GET"))
            .and(path("/start"))
            .respond_with(
                ResponseTemplate::new(302).insert_header("location", format!("{base}/dest")),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/dest"))
            .respond_with(ResponseTemplate::new(200).set_body_string("arrived"))
            .mount(&server)
            .await;

        let (response, _capture) =
            send_via_tap(get_request(&format!("{base}/start"), "tap-redirect"), CancellationToken::new())
                .await
                .expect("redirect chain should resolve to the final 200");

        assert_eq!(response.status, 200);
        assert_eq!(response.body, "arrived");
    }

    // TC-004 -> AC-004 - behavior: a redirect loop (A -> B -> A) terminates in Err at the
    // bounded redirect cap instead of hanging forever.
    #[tokio::test]
    async fn should_return_err_if_redirects_form_a_loop() {
        let server = MockServer::start().await;
        let base = server.uri();
        Mock::given(method("GET"))
            .and(path("/ping"))
            .respond_with(
                ResponseTemplate::new(302).insert_header("location", format!("{base}/pong")),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/pong"))
            .respond_with(
                ResponseTemplate::new(302).insert_header("location", format!("{base}/ping")),
            )
            .mount(&server)
            .await;

        let result =
            send_via_tap(get_request(&format!("{base}/ping"), "tap-loop"), CancellationToken::new()).await;

        assert!(result.is_err(), "a redirect loop must terminate in Err, not hang");
    }

    // TC-005 -> AC-005 - behavior: a response sent with `Content-Encoding: gzip` and a
    // gzip-compressed body is transparently decoded so `response.body` equals the
    // original plaintext.
    #[tokio::test]
    async fn should_transparently_decode_a_gzip_encoded_body() {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;

        let plaintext = "the quick brown fox jumps over the lazy dog";
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(plaintext.as_bytes()).expect("gzip write");
        let gzipped = encoder.finish().expect("gzip finish");

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/gz"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-encoding", "gzip")
                    .set_body_bytes(gzipped),
            )
            .mount(&server)
            .await;

        let (response, _capture) =
            send_via_tap(get_request(&format!("{}/gz", server.uri()), "tap-gzip"), CancellationToken::new())
                .await
                .expect("gzip send should succeed");

        assert_eq!(response.status, 200);
        assert_eq!(response.body, plaintext);
    }

    // TC-005 -> AC-005 - behavior: a `Content-Encoding: br` (brotli) body is transparently
    // decoded to the original plaintext (AC-005 names br explicitly, beside gzip).
    #[tokio::test]
    async fn should_transparently_decode_a_brotli_encoded_body() {
        use std::io::Write;

        let plaintext = "brotli payload that should round-trip through the decoder";
        let mut compressed = Vec::new();
        {
            let mut writer =
                brotli::CompressorWriter::new(&mut compressed, 4096, 5, 22);
            writer.write_all(plaintext.as_bytes()).expect("brotli write");
        }

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/br"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-encoding", "br")
                    .set_body_bytes(compressed),
            )
            .mount(&server)
            .await;

        let (response, _capture) =
            send_via_tap(get_request(&format!("{}/br", server.uri()), "tap-brotli"), CancellationToken::new())
                .await
                .expect("brotli send should succeed");

        assert_eq!(response.status, 200);
        assert_eq!(response.body, plaintext);
    }

    // TC-006 -> AC-006 - behavior: after an https send to a loopback server offering
    // ALPN `h2` + `http/1.1`, `Capture.alpn` is Some("h2") or Some("http/1.1").
    #[tokio::test]
    async fn should_capture_h2_or_http11_alpn_after_an_https_send() {
        let addr = spawn_loopback_tls_server().await;

        let (_response, capture) = send_via_tap(
            get_request(&format!("https://localhost:{}/", addr.port()), "tap-alpn"),
            CancellationToken::new(),
        )
        .await
        .expect("https send should succeed against the loopback TLS server");

        match capture.alpn.as_deref() {
            Some("h2") | Some("http/1.1") => {}
            other => panic!("expected a negotiated ALPN protocol, got {other:?}"),
        }
    }

    // TC-001 -> AC-009 - behavior: a server that delays the response ~200ms attributes that
    // delay to the WAITING phase (time-to-first-byte), NOT to connect. Pins the per-phase
    // semantics (connect = TCP+TLS only), not just that the four phases sum to the total - a
    // sum-only check would pass even if connect wrongly swallowed the whole round-trip.
    #[tokio::test]
    async fn should_attribute_response_delay_to_waiting_not_connect() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/delayed"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_millis(200))
                    .set_body_string("done"),
            )
            .mount(&server)
            .await;

        let (response, _capture) = send_via_tap(
            get_request(&format!("{}/delayed", server.uri()), "tap-waiting"),
            CancellationToken::new(),
        )
        .await
        .expect("delayed send should succeed");

        let timings = response.timings.expect("timings present");
        // The loopback connect is sub-millisecond; the injected 200ms delay must land in
        // waiting, so waiting dominates and connect stays small.
        assert!(
            timings.waiting_ms >= 150,
            "the response delay should be in waiting, got waiting={} connect={}",
            timings.waiting_ms,
            timings.connect_ms
        );
        assert!(
            timings.connect_ms < 100,
            "connect must not swallow the response delay, got connect={} waiting={}",
            timings.connect_ms,
            timings.waiting_ms
        );
    }

    // TC-007 -> AC-007 - behavior: a concurrent `token.cancel()` during an in-flight
    // (delayed) send makes `send_via_tap` resolve to Err equal to the crate cancel
    // sentinel ("__cancelled__").
    #[tokio::test]
    async fn should_resolve_to_the_cancel_sentinel_if_cancelled_mid_flight() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/hang"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(30)))
            .mount(&server)
            .await;

        let token = CancellationToken::new();
        let request = get_request(&format!("{}/hang", server.uri()), "tap-cancel");
        let send = tokio::spawn(send_via_tap(request, token.clone()));

        tokio::time::sleep(Duration::from_millis(50)).await;
        token.cancel();

        let result = send.await.expect("the send task should not panic");
        match result {
            Err(error) => assert_eq!(error, CANCEL_SENTINEL),
            Ok(_) => panic!("a cancelled send must not resolve to Ok"),
        }
    }

    // TC-008 -> AC-008 - behavior: a connection to a closed port returns Err and does not
    // panic.
    #[tokio::test]
    async fn should_return_err_if_the_host_is_unreachable() {
        let result = send_via_tap(
            get_request("http://127.0.0.1:1/unreachable", "tap-unreachable"),
            CancellationToken::new(),
        )
        .await;

        assert!(result.is_err(), "an unreachable host must be a transport Err");
    }

    // TC-009 -> AC-008 - behavior: a server that delays past a small `timeout_ms` returns
    // Err.
    #[tokio::test]
    async fn should_return_err_if_the_server_delays_past_the_timeout() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/slow"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(3)))
            .mount(&server)
            .await;

        let mut request = get_request(&format!("{}/slow", server.uri()), "tap-timeout");
        request.timeout_ms = 300;

        let result = send_via_tap(request, CancellationToken::new()).await;

        assert!(result.is_err(), "a send past timeout_ms must return Err");
    }

    // TC-010 -> AC-010 - side-effect-contract: after a successful https send, the returned
    // Capture has Some(peer_addr), a non-empty raw TLS record log (tls_records_in),
    // non-empty decrypted app-data (app_data_in), and Some(tls_version).
    #[tokio::test]
    async fn should_capture_tls_tap_points_after_a_successful_https_send() {
        let addr = spawn_loopback_tls_server().await;

        let (_response, capture) = send_via_tap(
            get_request(&format!("https://localhost:{}/", addr.port()), "tap-points"),
            CancellationToken::new(),
        )
        .await
        .expect("https send should succeed against the loopback TLS server");

        assert!(capture.peer_addr.is_some(), "peer_addr should be captured");
        assert!(!capture.tls_records_in.is_empty(), "raw TLS record log should be non-empty");
        assert!(!capture.app_data_in.is_empty(), "decrypted app-data should be non-empty");
        assert!(capture.tls_version.is_some(), "negotiated TLS version should be captured");
    }

    // TC-011 -> AC-011: the runtime flag `REQUI_TAP_CLIENT` selection lives in lib.rs's
    // send_http_request, not in tap_client, so it is unobservable from these module
    // tests. Flag cutover is verified via lib.rs send_http_request tests + manual run.

    // AC-001/AC-006/AC-010 over a REAL public HTTPS endpoint, using the production
    // webpki-roots trust anchors (the loopback TLS tests bypass those via the test-root
    // seam). Ignored by default so offline/CI runs never flake; run explicitly with
    // `cargo test -- --ignored real_https`.
    #[tokio::test]
    #[ignore = "network: hits https://example.com; run with --ignored"]
    async fn should_complete_a_real_https_send_against_the_public_trust_roots() {
        let (response, capture) = send_via_tap(
            get_request("https://example.com/", "tap-real-https"),
            CancellationToken::new(),
        )
        .await
        .expect("a real https send should succeed against the public trust roots");

        assert_eq!(response.status, 200);
        assert!(response.body.contains("Example Domain"));
        assert!(capture.tls_version.is_some());
        assert!(capture.alpn.is_some());
        assert!(!capture.tls_records_in.is_empty());
    }

    // Loopback TLS server offering ALPN `h2` + `http/1.1` with an rcgen self-signed cert.
    // Registers its cert into the client's test trust seam so the handshake succeeds.
    // Speaks a minimal HTTP/1.1 response (so ALPN resolves to http/1.1 in practice; the
    // client still offers h2, exercising the ALPN capture).
    async fn spawn_loopback_tls_server() -> std::net::SocketAddr {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let certified = rcgen::generate_simple_self_signed(vec!["localhost".to_string()])
            .expect("generate self-signed cert");
        let cert_der = certified.cert.der().clone();
        TEST_EXTRA_ROOTS.lock().unwrap().push(cert_der.clone());
        let key_der =
            rustls::pki_types::PrivateKeyDer::Pkcs8(certified.key_pair.serialize_der().into());

        let mut config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .expect("safe default protocol versions")
        .with_no_client_auth()
        .with_single_cert(vec![cert_der], key_der)
        .expect("server single cert");
        config.alpn_protocols = vec![b"http/1.1".to_vec()];

        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind loopback listener");
        let addr = listener.local_addr().expect("listener local addr");

        tokio::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                let acceptor = acceptor.clone();
                tokio::spawn(async move {
                    let Ok(mut tls) = acceptor.accept(tcp).await else {
                        return;
                    };
                    let mut buf = [0u8; 2048];
                    let _ = tls.read(&mut buf).await;
                    let body = "{\"tls\":true}";
                    let response = format!(
                        "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = tls.write_all(response.as_bytes()).await;
                    let _ = tls.flush().await;
                });
            }
        });

        addr
    }
}
