use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

mod dissect;
mod hpack;
mod logging;
mod pcap_capture;
mod quic_crypto;
mod tap_client;

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

const CANCEL_SENTINEL: &str = "__cancelled__";

// Accumulated per-send phase timings (microseconds), shared into the custom DNS
// resolver and the connector layer. One instance per `send_http_request` call
// (fresh client per send), so no cross-request contamination.
#[derive(Debug, Default, Clone)]
struct TimingProbe {
    dns_micros: Arc<AtomicU64>,
    connect_micros: Arc<AtomicU64>,
}

// A `reqwest::dns::Resolve` wrapper that times each lookup and delegates to the
// OS resolver (`getaddrinfo`-equivalent), matching reqwest's default GAI behavior.
struct TimingResolver {
    probe: TimingProbe,
}

impl reqwest::dns::Resolve for TimingResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let dns_micros = self.probe.dns_micros.clone();
        let host = name.as_str().to_string();
        Box::pin(async move {
            let start = Instant::now();
            let lookup = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map(|addrs| addrs.collect::<Vec<_>>());
            dns_micros.fetch_add(start.elapsed().as_micros() as u64, Ordering::Relaxed);
            match lookup {
                Ok(addrs) => Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs),
                Err(err) => Err(Box::new(err) as Box<dyn std::error::Error + Send + Sync>),
            }
        })
    }
}

// A generic Tower layer added via `ClientBuilder::connector_layer` that times each
// connection establishment (TCP + TLS). Generic over the inner service, so
// reqwest's sealed connector types are never named. The measured span includes
// DNS (the connector drives resolution), so `connect_ms` is reported downstream as
// `connect_span - dns_ms` to avoid double-counting.
#[derive(Clone)]
struct TimingConnectorLayer {
    probe: TimingProbe,
}

impl<S> tower_layer::Layer<S> for TimingConnectorLayer {
    type Service = TimingConnector<S>;

    fn layer(&self, inner: S) -> Self::Service {
        TimingConnector {
            inner,
            probe: self.probe.clone(),
        }
    }
}

#[derive(Clone)]
struct TimingConnector<S> {
    inner: S,
    probe: TimingProbe,
}

impl<S, Req> tower_service::Service<Req> for TimingConnector<S>
where
    S: tower_service::Service<Req>,
    S::Future: Send + 'static,
    S::Response: Send + 'static,
    S::Error: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<S::Response, S::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Req) -> Self::Future {
        let future = self.inner.call(req);
        let connect_micros = self.probe.connect_micros.clone();
        let start = Instant::now();
        Box::pin(async move {
            let result = future.await;
            connect_micros.fetch_add(start.elapsed().as_micros() as u64, Ordering::Relaxed);
            result
        })
    }
}

// Per-request cancellation tokens, keyed by the wire `requestId`. A send
// registers its token here and removes it on every exit; a cancel fires it.
static CANCELS: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// Removes the request's token from the registry on drop, so no send path can
// leak an entry (success, error, or cancel all unwind through this).
struct CancelGuard {
    request_id: String,
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        CANCELS.lock().unwrap().remove(&self.request_id);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct KeyValue {
    pub(crate) key: String,
    pub(crate) value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HttpRequestPayload {
    pub(crate) method: String,
    pub(crate) url: String,
    pub(crate) headers: Vec<KeyValue>,
    pub(crate) body: Option<String>,
    pub(crate) timeout_ms: u64,
    pub(crate) request_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResponseTimings {
    pub(crate) dns_ms: u64,
    pub(crate) connect_ms: u64,
    pub(crate) waiting_ms: u64,
    pub(crate) download_ms: u64,
}

impl ResponseTimings {
    // Partition a send into four non-overlapping phases (whole ms, saturating so a
    // phase never underflows). `connect_span_ms` is the connector's measured span,
    // which includes DNS (the connector drives resolution) - so `connect_ms`
    // subtracts DNS to avoid double-counting it. `waiting_ms` is the remainder from
    // the end of the connect span to response headers (request write + TTFB).
    pub(crate) fn partition(
        dns_ms: u64,
        connect_span_ms: u64,
        to_headers_ms: u64,
        download_ms: u64,
    ) -> Self {
        Self {
            dns_ms,
            connect_ms: connect_span_ms.saturating_sub(dns_ms),
            waiting_ms: to_headers_ms.saturating_sub(connect_span_ms),
            download_ms,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HttpResponsePayload {
    pub(crate) status: u16,
    pub(crate) time_ms: u64,
    pub(crate) size_bytes: usize,
    pub(crate) body: String,
    pub(crate) headers: Vec<KeyValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) timings: Option<ResponseTimings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) dissection: Option<dissect::Dissection>,
}

// Runtime flag selecting the send implementation, so the cutover to the hand-rolled tap
// client is reversible and both paths stay testable. Default ON (tap); `REQUI_TAP_CLIENT=0`
// forces the legacy reqwest path.
fn use_tap_client() -> bool {
    std::env::var("REQUI_TAP_CLIENT")
        .map(|value| value != "0")
        .unwrap_or(true)
}

#[tauri::command]
async fn send_http_request(request: HttpRequestPayload) -> Result<HttpResponsePayload, String> {
    log::info!("send {} {}", request.method, request.url);

    let token = CancellationToken::new();
    CANCELS
        .lock()
        .unwrap()
        .insert(request.request_id.clone(), token.clone());
    let _guard = CancelGuard {
        request_id: request.request_id.clone(),
    };

    if use_tap_client() {
        let method = request.method.clone();
        let url = request.url.clone();
        // Best-effort L2-L4 packet capture (OFF unless REQUI_PCAP=1). Runs on its own thread for
        // the duration of the send; never blocks or affects the send path. Started before the
        // send so it catches the SYN handshake; filtered to the connection 4-tuple afterwards.
        let capture_handle = pcap_capture::start_unfiltered(Duration::from_secs(30));
        let (mut response, tap) = tap_client::send_via_tap(request, token).await?;
        let packets = match capture_handle {
            Some(handle) => {
                let raw = handle.finish();
                pcap_capture::filter_to_connection(raw, tap.local_addr, tap.peer_addr)
            }
            None => pcap_capture::PacketCapture::default(),
        };
        response.dissection = dissect::dissect_with_packets(&tap, &packets);
        log::info!(
            "recv {} {} ({} in {}ms)",
            method,
            url,
            response.status,
            response.time_ms
        );
        return Ok(response);
    }

    send_via_reqwest(request, token).await
}

async fn send_via_reqwest(
    request: HttpRequestPayload,
    token: CancellationToken,
) -> Result<HttpResponsePayload, String> {
    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|err| format!("Invalid method: {err}"))?;
    let probe = TimingProbe::default();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(request.timeout_ms))
        .dns_resolver(Arc::new(TimingResolver {
            probe: probe.clone(),
        }))
        .connector_layer(TimingConnectorLayer {
            probe: probe.clone(),
        })
        .build()
        .map_err(|err| format!("Failed to build client: {err}"))?;

    let mut builder = client.request(method, &request.url);
    for header in &request.headers {
        builder = builder.header(&header.key, &header.value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let start = Instant::now();
    let response = tokio::select! {
        biased;
        _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
        result = builder.send() => result.map_err(|err| format!("Request failed: {err}"))?,
    };
    let to_headers_ms = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| KeyValue {
            key: name.to_string(),
            value: value.to_str().unwrap_or_default().to_string(),
        })
        .collect();
    let download_start = Instant::now();
    let body = tokio::select! {
        biased;
        _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
        result = response.text() => result.map_err(|err| format!("Failed to read response body: {err}"))?,
    };
    let download_ms = download_start.elapsed().as_millis() as u64;
    let time_ms = start.elapsed().as_millis() as u64;
    let size_bytes = body.len();
    log::info!("recv {} {} ({status} in {time_ms}ms)", request.method, request.url);

    let dns_ms = probe.dns_micros.load(Ordering::Relaxed) / 1000;
    let connect_span_ms = probe.connect_micros.load(Ordering::Relaxed) / 1000;
    let timings = ResponseTimings::partition(dns_ms, connect_span_ms, to_headers_ms, download_ms);

    Ok(HttpResponsePayload {
        status,
        time_ms,
        size_bytes,
        body,
        headers,
        timings: Some(timings),
        // The legacy reqwest path owns no socket/TLS session, so it produces no capture to
        // dissect. Dissection is exclusive to the tap client.
        dissection: None,
    })
}

#[tauri::command]
async fn cancel_http_request(request_id: String) {
    log::info!("cancel {request_id}");
    let token = CANCELS.lock().unwrap().get(&request_id).cloned();
    if let Some(token) = token {
        token.cancel();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            logging::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_http_request,
            cancel_http_request,
            logging::log_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_deserialize_the_wire_request_from_the_frontend_camel_case_shape() {
        let json = r#"{
            "method": "POST",
            "url": "https://postman-echo.com/post",
            "headers": [{ "key": "X-Test", "value": "1" }],
            "body": "{\"a\":1}",
            "auth": { "type": "none" },
            "timeoutMs": 5000,
            "requestId": "abc-123"
        }"#;

        let parsed: HttpRequestPayload = serde_json::from_str(json).unwrap();

        assert_eq!(parsed.method, "POST");
        assert_eq!(parsed.url, "https://postman-echo.com/post");
        assert_eq!(parsed.headers.len(), 1);
        assert_eq!(parsed.headers[0].key, "X-Test");
        assert_eq!(parsed.body.as_deref(), Some("{\"a\":1}"));
        assert_eq!(parsed.timeout_ms, 5000);
        assert_eq!(parsed.request_id, "abc-123");
    }

    #[test]
    fn should_accept_query_as_a_reqwest_extension_method() {
        let method = reqwest::Method::from_bytes(b"QUERY").expect("QUERY is a valid method token");

        assert_eq!(method.as_str(), "QUERY");
    }

    #[test]
    fn should_deserialize_a_null_body_as_none() {
        let json = r#"{
            "method": "GET",
            "url": "https://postman-echo.com/get",
            "headers": [],
            "body": null,
            "timeoutMs": 30000,
            "requestId": "def-456"
        }"#;

        let parsed: HttpRequestPayload = serde_json::from_str(json).unwrap();

        assert!(parsed.body.is_none());
    }

    #[test]
    fn should_serialize_the_response_to_the_frontend_camel_case_shape() {
        let payload = HttpResponsePayload {
            status: 200,
            time_ms: 142,
            size_bytes: 18,
            body: "{\"ok\":true}".to_string(),
            headers: vec![KeyValue {
                key: "Content-Type".to_string(),
                value: "application/json".to_string(),
            }],
            timings: None,
            dissection: None,
        };

        let json = serde_json::to_value(&payload).unwrap();

        assert_eq!(json["status"], 200);
        assert_eq!(json["timeMs"], 142);
        assert_eq!(json["sizeBytes"], 18);
        assert_eq!(json["body"], "{\"ok\":true}");
        assert_eq!(json["headers"][0]["key"], "Content-Type");
    }

    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn request_to(url: &str, request_id: &str) -> HttpRequestPayload {
        HttpRequestPayload {
            method: "GET".to_string(),
            url: url.to_string(),
            headers: vec![],
            body: None,
            timeout_ms: 5000,
            request_id: request_id.to_string(),
        }
    }

    // Head-to-head latency of the two send clients against the SAME local wiremock server,
    // so the only variable is client overhead (no external network). Prints min/median/
    // mean/max per client. Ignored by default (perf, not a pass/fail assertion); run with
    // `cargo test --release -- --ignored --nocapture bench_tap_vs_reqwest`.
    #[tokio::test]
    #[ignore = "perf benchmark; run with --release --ignored --nocapture"]
    async fn bench_tap_vs_reqwest() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/bench"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "application/json")
                    .set_body_string(r#"{"ok":true,"payload":"benchmark response body"}"#),
            )
            .mount(&server)
            .await;
        let url = format!("{}/bench", server.uri());

        const WARMUP: usize = 20;
        const ITERS: usize = 200;

        async fn time_reqwest(url: &str) -> u128 {
            let start = std::time::Instant::now();
            send_via_reqwest(
                super::HttpRequestPayload {
                    method: "GET".to_string(),
                    url: url.to_string(),
                    headers: vec![],
                    body: None,
                    timeout_ms: 5000,
                    request_id: "bench-reqwest".to_string(),
                },
                CancellationToken::new(),
            )
            .await
            .expect("reqwest send");
            start.elapsed().as_micros()
        }

        async fn time_tap(url: &str) -> u128 {
            let start = std::time::Instant::now();
            tap_client::send_via_tap(
                super::HttpRequestPayload {
                    method: "GET".to_string(),
                    url: url.to_string(),
                    headers: vec![],
                    body: None,
                    timeout_ms: 5000,
                    request_id: "bench-tap".to_string(),
                },
                CancellationToken::new(),
            )
            .await
            .expect("tap send");
            start.elapsed().as_micros()
        }

        fn stats(label: &str, mut samples: Vec<u128>) {
            samples.sort_unstable();
            let n = samples.len();
            let sum: u128 = samples.iter().sum();
            let to_ms = |micros: u128| micros as f64 / 1000.0;
            println!(
                "{label}: n={n}  min={:.3}ms  median={:.3}ms  mean={:.3}ms  p95={:.3}ms  max={:.3}ms",
                to_ms(samples[0]),
                to_ms(samples[n / 2]),
                to_ms(sum / n as u128),
                to_ms(samples[(n * 95 / 100).min(n - 1)]),
                to_ms(samples[n - 1]),
            );
        }

        // Interleave warmup, then interleave measured iterations so neither client is
        // advantaged by a cold or warm connection-pool phase.
        for _ in 0..WARMUP {
            time_reqwest(&url).await;
            time_tap(&url).await;
        }
        let mut reqwest_samples = Vec::with_capacity(ITERS);
        let mut tap_samples = Vec::with_capacity(ITERS);
        for _ in 0..ITERS {
            reqwest_samples.push(time_reqwest(&url).await);
            tap_samples.push(time_tap(&url).await);
        }

        println!("\n=== send-client latency (local wiremock, {ITERS} iters) ===");
        stats("reqwest", reqwest_samples);
        stats("tap    ", tap_samples);
    }

    // Full send_http_request path WITH live packet capture on loopback: proves the pcap side-car
    // wires into a real send and upgrades L3/L4 to decoded from real captured bytes. Ignored -
    // needs REQUI_PCAP=1 + REQUI_PCAP_DEVICE=lo0 + BPF access. Run:
    //   REQUI_PCAP=1 REQUI_PCAP_DEVICE=lo0 cargo test --lib -- --ignored --nocapture full_path_capture
    #[tokio::test]
    #[ignore = "needs REQUI_PCAP=1 + REQUI_PCAP_DEVICE=lo0 + BPF access; live loopback capture"]
    async fn should_decode_l3_l4_from_captured_packets_on_the_full_send_path() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cap"))
            .respond_with(ResponseTemplate::new(200).set_body_string("captured-ok"))
            .mount(&server)
            .await;

        // Full command path: send_http_request wires the pcap side-car itself.
        let response = send_http_request(request_to(
            &format!("{}/cap", server.uri()),
            "req-capture",
        ))
        .await
        .expect("send should succeed");

        let dissection = response.dissection.expect("dissection present");
        let network = dissection
            .layers
            .iter()
            .find(|l| l.osi == 3)
            .expect("network layer");
        let transport = dissection
            .layers
            .iter()
            .find(|l| l.osi == 4)
            .expect("transport layer");
        println!(
            "L3 segments={} L4 segments={}",
            network.segments.len(),
            transport.segments.len()
        );
        assert!(
            !transport.segments.is_empty(),
            "expected a decoded TCP segment from captured packets"
        );
        assert!(
            !network.segments.is_empty(),
            "expected a decoded IP header from captured packets"
        );
    }

    // Full send path against a REAL external host over the egress interface (en0, Ethernet
    // linktype, real network timing) - proves live capture upgrades L2/L3/L4 to decoded outside
    // loopback. Guards against the `Device::lookup()` -> bogus `ap1` regression that captured 0
    // packets. Ignored - needs REQUI_PCAP=1 + BPF access + network egress. Run:
    //   REQUI_PCAP=1 cargo test --lib -- --ignored --nocapture en0_external_capture
    #[tokio::test]
    #[ignore = "needs REQUI_PCAP=1 + BPF access + network egress; hits a real external host"]
    async fn en0_external_capture() {
        let response = send_http_request(request_to(
            "https://countries.trevorblades.com/",
            "req-en0",
        ))
        .await
        .expect("send should succeed");

        let dissection = response.dissection.expect("dissection present");
        let l3 = dissection.layers.iter().find(|l| l.osi == 3).unwrap();
        let l4 = dissection.layers.iter().find(|l| l.osi == 4).unwrap();
        println!(
            "L3 reach={:?} segs={} | L4 reach={:?} segs={}",
            l3.reach,
            l3.segments.len(),
            l4.reach,
            l4.segments.len(),
        );
        assert!(!l4.segments.is_empty(), "expected a decoded TCP segment over en0");
        assert!(!l3.segments.is_empty(), "expected a decoded IP header over en0");
    }

    // TC-011, AC-011 - behavior: the legacy reqwest send path (selected when the flag is
    // off) still returns a correct 200 + body, so the tap cutover is reversible. Calls
    // send_via_reqwest directly to avoid mutating the process-wide REQUI_TAP_CLIENT env var
    // (which would race other async tests). The default send_http_request path (tap) is
    // covered by the tests below + tap_client::tap_tests.
    #[tokio::test]
    async fn should_serve_a_200_over_the_legacy_reqwest_path_when_selected() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/legacy"))
            .respond_with(ResponseTemplate::new(200).set_body_string("legacy-ok"))
            .mount(&server)
            .await;

        let result = send_via_reqwest(
            request_to(&format!("{}/legacy", server.uri()), "req-legacy"),
            CancellationToken::new(),
        )
        .await
        .expect("legacy reqwest path should succeed");

        assert_eq!(result.status, 200);
        assert_eq!(result.body, "legacy-ok");
        assert!(result.timings.is_some());
    }

    // TC-007, AC-006 - behavior: a 200 + JSON body + header parses into the payload.
    #[tokio::test]
    async fn should_parse_a_successful_response_if_the_server_returns_200() {
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

        let result = send_http_request(request_to(
            &format!("{}/ok", server.uri()),
            "req-success",
        ))
        .await
        .expect("send should succeed");

        assert_eq!(result.status, 200);
        assert_eq!(result.body, "{\"ok\":true}");
        assert_eq!(result.size_bytes, result.body.len());
        assert!(result
            .headers
            .iter()
            .any(|header| header.key.eq_ignore_ascii_case("x-live")
                && header.value == "yes"));
    }

    // TC-007, AC-006 - behavior: an HTTP 500 is Ok(500), not a transport error.
    #[tokio::test]
    async fn should_return_ok_with_status_500_if_the_server_errors() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/boom"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let result = send_http_request(request_to(
            &format!("{}/boom", server.uri()),
            "req-500",
        ))
        .await
        .expect("HTTP 500 should still be Ok");

        assert_eq!(result.status, 500);
    }

    // TC-007, AC-006 - behavior: an unreachable host is a transport error (Err).
    #[tokio::test]
    async fn should_return_err_if_the_host_is_unreachable() {
        let result = send_http_request(request_to(
            "http://127.0.0.1:1/unreachable",
            "req-unreachable",
        ))
        .await;

        assert!(result.is_err());
    }

    // TC-006, AC-003 - behavior + side-effect-contract: a concurrent cancel aborts
    // the in-flight send to the sentinel and removes the id from the registry.
    #[tokio::test]
    async fn should_abort_the_send_to_the_cancel_sentinel_if_cancelled() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/hang"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(std::time::Duration::from_secs(30)),
            )
            .mount(&server)
            .await;

        let request_id = "req-cancel".to_string();
        let url = format!("{}/hang", server.uri());
        let send = tokio::spawn(send_http_request(request_to(&url, &request_id)));

        // Give the send a moment to register its token, then cancel it.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        cancel_http_request(request_id.clone()).await;

        let result = send.await.expect("the send task should not panic");
        match result {
            Err(error) => assert_eq!(error, CANCEL_SENTINEL),
            Ok(_) => panic!("a cancelled send must not resolve to Ok"),
        }
        assert!(!CANCELS.lock().unwrap().contains_key(&request_id));
    }

    // TC-001, AC-001/002 - behavior: a successful send carries a timings object
    // whose four phases partition the total (sum <= time_ms, within a rounding gap).
    #[tokio::test]
    async fn should_return_timings_that_partition_the_total_if_the_send_succeeds() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/timed"))
            .respond_with(ResponseTemplate::new(200).set_body_string("{\"ok\":true}"))
            .mount(&server)
            .await;

        let result = send_http_request(request_to(
            &format!("{}/timed", server.uri()),
            "req-timings",
        ))
        .await
        .expect("send should succeed");

        let timings = result
            .timings
            .expect("a successful send should carry timings");
        let sum =
            timings.dns_ms + timings.connect_ms + timings.waiting_ms + timings.download_ms;
        assert!(
            sum <= result.time_ms,
            "phases {sum} must not exceed total {}",
            result.time_ms
        );
        assert!(
            sum >= result.time_ms.saturating_sub(4),
            "phases {sum} must be within a rounding gap of total {}",
            result.time_ms
        );
    }

    // TC-002, AC-003 - behavior: DNS is subtracted from the connector span so it is
    // reported only in dns_ms, never double-counted in connect_ms. Deterministic (no
    // network): a non-zero DNS span (20ms) inside a 50ms connect span must yield
    // connect_ms = 30, and the four phases must partition the total exactly.
    #[test]
    fn should_exclude_dns_time_from_connect() {
        // dns=20ms, connect_span=50ms (INCLUDES dns), headers at 90ms, download 8ms.
        let timings = ResponseTimings::partition(20, 50, 90, 8);

        assert_eq!(timings.dns_ms, 20);
        assert_eq!(timings.connect_ms, 30); // 50 span - 20 dns, NOT 50
        assert_eq!(timings.waiting_ms, 40); // 90 to-headers - 50 span
        assert_eq!(timings.download_ms, 8);

        // Phases partition the whole time (to_headers + download): 20+30+40+8 == 98.
        let sum =
            timings.dns_ms + timings.connect_ms + timings.waiting_ms + timings.download_ms;
        assert_eq!(sum, 90 + 8);
    }

    // AC-003 (edge): saturating subtraction clamps to 0 when a measured span would
    // otherwise underflow (clock skew / connection reuse), never wrapping.
    #[test]
    fn should_clamp_phases_to_zero_if_a_span_would_underflow() {
        // connect span (10) smaller than dns (15); to_headers (5) smaller than span.
        let timings = ResponseTimings::partition(15, 10, 5, 0);

        assert_eq!(timings.connect_ms, 0);
        assert_eq!(timings.waiting_ms, 0);
    }

    // TC-002, AC-003 - behavior: over the real send path timings stay within the
    // total (integration guard that the wired resolver/connector produce sane data).
    #[tokio::test]
    async fn should_exclude_dns_time_from_connect_if_the_send_succeeds() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/dns"))
            .respond_with(ResponseTemplate::new(200).set_body_string("{}"))
            .mount(&server)
            .await;

        let result = send_http_request(request_to(
            &format!("{}/dns", server.uri()),
            "req-dns",
        ))
        .await
        .expect("send should succeed");

        let timings = result
            .timings
            .expect("a successful send should carry timings");
        assert!(timings.connect_ms <= result.time_ms);
        assert!(timings.dns_ms + timings.connect_ms <= result.time_ms);
    }

    // TC-003, AC-004 - behavior: an unreachable host stays on the Err path, so no
    // response payload (and therefore no timings) is produced.
    #[tokio::test]
    async fn should_yield_no_timings_if_the_send_fails_with_an_unreachable_host() {
        let result = send_http_request(request_to(
            "http://127.0.0.1:1/no-timings",
            "req-fail-timings",
        ))
        .await;

        assert!(result.is_err());
    }

    // TC-004, AC-005 - behavior: timings serialize camelCase when present and the
    // key is omitted entirely when absent (backward compatible with legacy responses).
    #[test]
    fn should_serialize_timings_camel_case_when_present_and_omit_the_key_when_absent() {
        let with_timings = HttpResponsePayload {
            status: 200,
            time_ms: 142,
            size_bytes: 18,
            body: "{}".to_string(),
            headers: vec![],
            timings: Some(ResponseTimings {
                dns_ms: 12,
                connect_ms: 34,
                waiting_ms: 88,
                download_ms: 8,
            }),
            dissection: None,
        };

        let json = serde_json::to_value(&with_timings).unwrap();
        assert_eq!(json["timings"]["dnsMs"], 12);
        assert_eq!(json["timings"]["connectMs"], 34);
        assert_eq!(json["timings"]["waitingMs"], 88);
        assert_eq!(json["timings"]["downloadMs"], 8);
        assert!(json.get("dissection").is_none());

        let without_timings = HttpResponsePayload {
            status: 200,
            time_ms: 142,
            size_bytes: 18,
            body: "{}".to_string(),
            headers: vec![],
            timings: None,
            dissection: None,
        };

        let json = serde_json::to_value(&without_timings).unwrap();
        assert!(json.get("timings").is_none());
    }
}
