use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

mod logging;

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

const CANCEL_SENTINEL: &str = "__cancelled__";

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
struct KeyValue {
    key: String,
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestPayload {
    method: String,
    url: String,
    headers: Vec<KeyValue>,
    body: Option<String>,
    timeout_ms: u64,
    request_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponsePayload {
    status: u16,
    time_ms: u64,
    size_bytes: usize,
    body: String,
    headers: Vec<KeyValue>,
}

#[tauri::command]
async fn send_http_request(request: HttpRequestPayload) -> Result<HttpResponsePayload, String> {
    log::info!("send {} {}", request.method, request.url);
    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|err| format!("Invalid method: {err}"))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(request.timeout_ms))
        .build()
        .map_err(|err| format!("Failed to build client: {err}"))?;

    let mut builder = client.request(method, &request.url);
    for header in &request.headers {
        builder = builder.header(&header.key, &header.value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let token = CancellationToken::new();
    CANCELS
        .lock()
        .unwrap()
        .insert(request.request_id.clone(), token.clone());
    let _guard = CancelGuard {
        request_id: request.request_id.clone(),
    };

    let start = Instant::now();
    let response = tokio::select! {
        biased;
        _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
        result = builder.send() => result.map_err(|err| format!("Request failed: {err}"))?,
    };

    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| KeyValue {
            key: name.to_string(),
            value: value.to_str().unwrap_or_default().to_string(),
        })
        .collect();
    let body = tokio::select! {
        biased;
        _ = token.cancelled() => return Err(CANCEL_SENTINEL.to_string()),
        result = response.text() => result.map_err(|err| format!("Failed to read response body: {err}"))?,
    };
    let time_ms = start.elapsed().as_millis() as u64;
    let size_bytes = body.len();
    log::info!("recv {} {} ({status} in {time_ms}ms)", request.method, request.url);

    Ok(HttpResponsePayload {
        status,
        time_ms,
        size_bytes,
        body,
        headers,
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
}
