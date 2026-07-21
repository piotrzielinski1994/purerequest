import type { HttpResponse } from "@/lib/http/model";
import {
  deserialize,
  type FileMap,
  serialize,
} from "@/lib/workspace/disk-format";
import type {
  KeyValue,
  RequestBody,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";

// In-memory fs key + dev-build settings `workspacePath`. The `npm run dev`
// browser build seeds this path so the workspace renders instead of the empty
// state (see `isDevBrowser`).
export const DEMO_WORKSPACE_PATH = "demo";

const WORKSPACE_NAME = "Demo";

const jsonBody = (json: string): RequestBody => ({
  active: "json",
  types: {
    json,
    form: [],
    multipart: [],
    graphql: { query: "", variables: "" },
  },
});
const queryParams = (query: KeyValue[]) => ({ path: [], query });

const tokenRequest: RequestNode = {
  kind: "request",
  id: "r-token",
  name: "/oauth/token",
  method: "POST",
  url: "{{baseUrl}}/oauth/token",
  body: jsonBody('{\n  "grant_type": "client_credentials"\n}'),
  params: queryParams([
    { key: "grant_type", value: "client_credentials" },
    { key: "scope", value: "read write" },
  ]),
  config: {
    headers: [
      { key: "Content-Type", value: "application/x-www-form-urlencoded" },
    ],
    auth: authOf({ active: "bearer", token: "ey.mock.token" }),
    scripts: { pre: "// pre-request script", post: "// post-response script" },
  },
  response: {
    status: 200,
    timeMs: 142,
    sizeBytes: 248,
    body: '{\n  "access_token": "ey.mock.token",\n  "expires_in": 3600\n}',
    headers: [
      { key: "Content-Type", value: "application/json" },
      { key: "Cache-Control", value: "no-store" },
    ],
  },
};

const refreshRequest: RequestNode = {
  kind: "request",
  id: "r-refresh",
  name: "/oauth/refresh",
  method: "GET",
  url: "{{baseUrl}}/oauth/refresh",
  body: emptyBody(),
  params: emptyParams(),
  config: {
    headers: [{ key: "Accept", value: "application/json" }],
    auth: authOf({ active: "bearer", token: "ey.refresh.token" }),
  },
  response: {
    status: 200,
    timeMs: 96,
    sizeBytes: 180,
    body: '{\n  "access_token": "ey.new.token"\n}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  },
};

const userinfoRequest: RequestNode = {
  kind: "request",
  id: "r-userinfo",
  name: "/oauth/userinfo",
  method: "GET",
  url: "{{baseUrl}}/oauth/userinfo",
  body: emptyBody(),
  params: emptyParams(),
  config: {
    headers: [{ key: "Authorization", value: "Bearer ey.mock.token" }],
    auth: authOf({ active: "bearer", token: "ey.mock.token" }),
  },
  response: {
    status: 200,
    timeMs: 71,
    sizeBytes: 132,
    body: '{\n  "sub": "user-1",\n  "name": "Ada"\n}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  },
};

const getUserRequest: RequestNode = {
  kind: "request",
  id: "r-getuser",
  name: "/users/:id",
  method: "GET",
  url: "{{baseUrl}}/users/:id",
  body: emptyBody(),
  params: {
    path: [{ key: "id", value: "1" }],
    query: [{ key: "expand", value: "roles" }],
  },
  config: {
    headers: [{ key: "Accept", value: "application/json" }],
    auth: authOf({ active: "basic", username: "admin", password: "s3cret" }),
  },
  response: {
    status: 200,
    timeMs: 64,
    sizeBytes: 210,
    body: '{\n  "id": 1,\n  "name": "Ada"\n}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  },
};

const invoicesRequest: RequestNode = {
  kind: "request",
  id: "r-invoices",
  name: "/billing/invoices",
  method: "GET",
  url: "{{baseUrl}}/billing/invoices",
  body: emptyBody(),
  params: queryParams([{ key: "status", value: "open" }]),
  config: {
    headers: [{ key: "Accept", value: "application/json" }],
    auth: authOf({ active: "bearer", token: "ey.billing.token" }),
  },
  response: {
    status: 200,
    timeMs: 188,
    sizeBytes: 540,
    body: '{\n  "invoices": []\n}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  },
};

const chargeRequest: RequestNode = {
  kind: "request",
  id: "r-charge",
  name: "/billing/charge",
  method: "POST",
  url: "{{baseUrl}}/billing/charge",
  body: jsonBody('{\n  "amount": 1999,\n  "currency": "eur"\n}'),
  params: emptyParams(),
  config: {
    headers: [{ key: "Content-Type", value: "application/json" }],
    auth: authOf({ active: "bearer", token: "ey.billing.token" }),
  },
  response: {
    status: 201,
    timeMs: 233,
    sizeBytes: 96,
    body: '{\n  "charge_id": "ch_1"\n}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  },
};

const healthRequest: RequestNode = {
  kind: "request",
  id: "r-health",
  name: "/health",
  method: "GET",
  url: "{{baseUrl}}/health",
  body: emptyBody(),
  params: emptyParams(),
  config: {
    auth: authOf({ active: "none" }),
  },
  response: {
    status: 200,
    timeMs: 12,
    sizeBytes: 18,
    body: '{\n  "ok": true\n}',
    headers: [{ key: "Content-Type", value: "application/json" }],
  },
};

// Hand-authored source. `serialize` drops `response`/synthetic ids and
// `deserialize` regenerates path-based ids, so the exported `demoTree` below is
// the round-tripped (canonical, loader-shaped) form - a fixed point of the disk
// format, which is exactly what the dev-build loader reads back.
const seedSource: TreeNode[] = [
  {
    kind: "folder",
    id: "f-auth",
    name: "auth",
    config: {
      variables: [{ key: "baseUrl", value: "https://api.example.com" }],
    },
    children: [
      {
        kind: "folder",
        id: "f-oauth",
        name: "oauth",
        config: {},
        children: [
          {
            kind: "folder",
            id: "f-tokens",
            name: "tokens",
            config: {},
            children: [tokenRequest, refreshRequest],
          },
          userinfoRequest,
        ],
      },
    ],
  },
  {
    kind: "folder",
    id: "f-users",
    name: "users",
    config: {},
    children: [getUserRequest],
  },
  {
    kind: "folder",
    id: "f-billing",
    name: "billing",
    config: {},
    children: [invoicesRequest, chargeRequest],
  },
  healthRequest,
];

const seedFiles: FileMap = serialize(seedSource, WORKSPACE_NAME);

const parsedSeed = deserialize(seedFiles);

// The canonical, loader-shaped demo tree (path-based ids, no `response`). Equal
// to `deserialize(demoFiles()).tree` by construction.
export const demoTree: TreeNode[] = parsedSeed.ok
  ? parsedSeed.tree
  : seedSource;

export const demoConsoleLines: string[] = [
  "[12:00:00] Ready.",
  "→ POST {{baseUrl}}/oauth/token  200",
  "← 142ms · 248B",
  "[script] pre-request ok",
];

// Canned success the fake HTTP client returns in the dev-browser build, so a
// Send shows a real response instead of the "no Tauri host" fake error.
export const DEMO_RESPONSE: HttpResponse = {
  status: 200,
  timeMs: 142,
  sizeBytes: 36,
  body: '{\n  "ok": true,\n  "demo": true\n}',
  headers: [{ key: "Content-Type", value: "application/json" }],
  timings: { dnsMs: 12, connectMs: 34, waitingMs: 88, downloadMs: 8 },
  dissection: {
    layers: [
      {
        osi: 7,
        name: "Application (HTTP/2)",
        summary: "1 message(s) decoded",
        reach: "decoded",
        fields: [
          {
            label: "Framing",
            value: "Binary frames",
            meaning:
              "HTTP/2 replaces text lines with length-prefixed binary frames multiplexed over one connection. Each 9-byte frame header carries a 24-bit length, an 8-bit type, an 8-bit flags field, and a reserved bit + 31-bit stream id.",
          },
        ],
        segments: [
          {
            title: "HTTP/2 frame (sent): HEADERS, stream 1",
            hex: "00 00 20 01 05 00 00 00 01",
            byteLen: 41,
            truncated: true,
            fields: [
              {
                label: "Length",
                value: "32 bytes",
                meaning:
                  "24-bit length of the frame payload following this 9-byte header.",
                byteOffset: 0,
                byteLength: 3,
              },
              {
                label: "Type",
                value: "HEADERS (1)",
                meaning:
                  "HEADERS carries the HPACK-compressed request/response header block.",
                byteOffset: 3,
                byteLength: 1,
              },
              {
                label: "Flags",
                value: "0x05  00000101",
                meaning:
                  "An 8-bit field of per-type boolean flags - each bit is a distinct signal.",
                byteOffset: 4,
                byteLength: 1,
                children: [
                  {
                    label: "END_STREAM",
                    value: "1 (set)",
                    meaning: "This HEADERS frame is the last for the stream.",
                    byteOffset: 4,
                    byteLength: 1,
                    bitOffset: 7,
                    bitLength: 1,
                  },
                  {
                    label: "END_HEADERS",
                    value: "1 (set)",
                    meaning:
                      "This frame completes the header block (no CONTINUATION follows).",
                    byteOffset: 4,
                    byteLength: 1,
                    bitOffset: 5,
                    bitLength: 1,
                  },
                  {
                    label: "PADDED",
                    value: "0 (clear)",
                    meaning: "The header block is not padded.",
                    byteOffset: 4,
                    byteLength: 1,
                    bitOffset: 4,
                    bitLength: 1,
                  },
                ],
              },
              {
                label: "Reserved (R)",
                value: "0",
                meaning:
                  "A single reserved bit, the high bit of the stream-id word. Must be 0.",
                byteOffset: 5,
                byteLength: 4,
                bitOffset: 0,
                bitLength: 1,
              },
              {
                label: "Stream Identifier",
                value: "1",
                meaning:
                  "The 31-bit stream this frame belongs to. Odd numbers are client-initiated request streams.",
                byteOffset: 5,
                byteLength: 4,
                bitOffset: 1,
                bitLength: 31,
              },
              {
                label: "Header block (HPACK)",
                value: "4 header(s)",
                meaning:
                  "The HPACK-compressed (RFC 7541) header block. Each header is an indexed reference into the static/dynamic tables or a literal name/value (optionally Huffman-coded), decoded here to plaintext.",
                byteOffset: 9,
                byteLength: 32,
                children: [
                  {
                    label: "Header",
                    value: ":method: GET",
                    meaning:
                      "An indexed header field: the whole name+value came from a single entry in the static or dynamic table (1 byte on the wire).",
                    byteOffset: 9,
                    byteLength: 1,
                  },
                  {
                    label: "Header",
                    value: ":scheme: https",
                    meaning:
                      "An indexed header field: the whole name+value came from a single entry in the static or dynamic table (1 byte on the wire).",
                    byteOffset: 10,
                    byteLength: 1,
                  },
                  {
                    label: "Header",
                    value: ":authority: example.com",
                    meaning:
                      "A literal header field with incremental indexing: sent as name+value and also added to the dynamic table for later reuse.",
                    byteOffset: 11,
                    byteLength: 14,
                  },
                  {
                    label: "Header",
                    value: ":path: /widgets",
                    meaning:
                      "A literal header field without indexing: sent as name+value for this message only, not added to the dynamic table.",
                    byteOffset: 25,
                    byteLength: 16,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        osi: 6,
        name: "Presentation (TLS)",
        summary: "Encrypted with TLSv1_3",
        reach: "decoded",
        fields: [
          {
            label: "TLS Version",
            value: "TLSv1_3",
            meaning:
              "The TLS protocol version negotiated in the handshake. TLS 1.3 is the modern default; 1.2 is the older widely-supported one.",
          },
          {
            label: "Cipher suite",
            value: "TLS13_AES_128_GCM_SHA256",
            meaning:
              "The agreed set of algorithms for key exchange, bulk encryption, and message authentication.",
          },
        ],
        segments: [
          {
            title: "TLS record (received): ChangeCipherSpec",
            hex: "14 03 03 00 01 01",
            byteLen: 6,
            truncated: false,
            fields: [
              {
                label: "Content Type",
                value: "ChangeCipherSpec (20)",
                meaning:
                  "The record type. Handshake sets up the session; ApplicationData carries the encrypted payload; Alert signals a warning/fatal error.",
                byteOffset: 0,
                byteLength: 1,
              },
              {
                label: "Legacy Version",
                value: "3.3 (0x0303)",
                meaning:
                  "The record-layer version, pinned to 0x0303 (TLS 1.2) in TLS 1.3 for middlebox compatibility.",
                byteOffset: 1,
                byteLength: 2,
              },
              {
                label: "Length",
                value: "1 bytes",
                meaning:
                  "Byte length of the record payload that follows this 5-byte header.",
                byteOffset: 3,
                byteLength: 2,
              },
              {
                label: "Payload",
                value: "ChangeCipherSpec (1 byte)",
                meaning:
                  "The ChangeCipherSpec message - a single legacy 0x01 byte signalling the switch to encrypted records (kept in TLS 1.3 only for middlebox compatibility; it carries no real meaning).",
                byteOffset: 5,
                byteLength: 1,
              },
            ],
          },
          {
            title: "TLS record (received): ApplicationData",
            hex: "17 03 03 00 13",
            byteLen: 24,
            truncated: true,
            fields: [
              {
                label: "Content Type",
                value: "ApplicationData (23)",
                meaning:
                  "The record type. ApplicationData carries the encrypted payload; the header is cleartext, the payload is not.",
                byteOffset: 0,
                byteLength: 1,
              },
              {
                label: "Legacy Version",
                value: "3.3 (0x0303)",
                meaning:
                  "The record-layer version, pinned to 0x0303 (TLS 1.2) in TLS 1.3 for middlebox compatibility.",
                byteOffset: 1,
                byteLength: 2,
              },
              {
                label: "Length",
                value: "19 bytes",
                meaning:
                  "Byte length of the encrypted payload following this 5-byte header.",
                byteOffset: 3,
                byteLength: 2,
              },
            ],
          },
        ],
      },
      {
        osi: 5,
        name: "Session",
        summary: "TLS session / ALPN (HTTP is otherwise stateless)",
        reach: "facts",
        fields: [
          {
            label: "ALPN",
            value: "h2",
            meaning:
              "Application-Layer Protocol Negotiation: the application protocol picked during the TLS handshake (h2 = HTTP/2). It establishes which application dialogue runs over this session.",
          },
          {
            label: "Session",
            value: "Established",
            meaning:
              "HTTP keeps no long-lived session of its own; the TLS session (its keys + negotiated parameters) is what plays the OSI session role here - one connection, one dialogue.",
          },
        ],
        segments: [],
      },
      {
        osi: 4,
        name: "Transport (TCP)",
        summary: "TCP endpoints (header bytes need packet capture)",
        reach: "facts",
        fields: [
          {
            label: "Protocol",
            value: "TCP",
            meaning:
              "A reliable, ordered, connection-oriented byte stream. HTTP always rides on TCP here.",
          },
          {
            label: "Remote port",
            value: "443",
            meaning: "The server's TCP port (443 for HTTPS, 80 for HTTP).",
          },
          {
            label: "Header bytes",
            value: "not available",
            meaning:
              "The real TCP header (sequence/ack numbers, window, SYN/ACK/FIN flags, checksum) lives in the kernel. Reading those bytes needs privileged packet capture (pcap/BPF); a userspace client only sees the socket endpoints.",
          },
        ],
        segments: [],
      },
      {
        osi: 3,
        name: "Network (IP)",
        summary: "IP addresses (header bytes need packet capture)",
        reach: "facts",
        fields: [
          {
            label: "IP version",
            value: "IPv4",
            meaning:
              "Which Internet Protocol version carried the packets - IPv4 (32-bit addresses) or IPv6 (128-bit).",
          },
          {
            label: "Remote address",
            value: "93.184.216.34",
            meaning: "The server's IP address, resolved from the host name.",
          },
          {
            label: "Header bytes",
            value: "not available",
            meaning:
              "The real IP header (TTL, flags, fragment offset, protocol, checksum) is set by the kernel. Decoding those bytes needs privileged packet capture; a userspace client only sees the addresses.",
          },
        ],
        segments: [],
      },
      {
        osi: 2,
        name: "Data Link",
        summary:
          "Ethernet / Wi-Fi frames - capturable only with a privileged packet-capture driver",
        reach: "privileged",
        fields: [
          {
            label: "Frames",
            value: "not captured here",
            meaning:
              "MAC addresses and Ethernet/Wi-Fi frame headers live below the IP stack. They ARE observable - this is exactly what Wireshark shows - but only via a privileged packet-capture path (libpcap/npcap plus root, a kernel driver, or BPF access). purerequest stays a normal unprivileged desktop app and does not install a capture driver or request root, so it doesn't decode this layer. That's a deliberate choice, not a hard limit.",
          },
        ],
        segments: [],
      },
      {
        osi: 1,
        name: "Physical",
        summary:
          "Electrical/optical/radio signalling - hardware, no software sees it",
        reach: "unreachable",
        fields: [
          {
            label: "Medium",
            value: "not observable",
            meaning:
              "The physical layer is the actual signals on copper, fiber, or radio. No software observes these - not even Wireshark, whose lowest captured unit is the Data Link frame the NIC hands up. The signalling itself is handled entirely by the network hardware.",
          },
        ],
        segments: [],
      },
    ],
  },
};

// The demo tree serialized to the on-disk format, so the dev-build loader reads
// it back through the real `deserialize` path (and the seed can't drift from a
// shape the loader would reject).
export function demoFiles(): FileMap {
  return seedFiles;
}
