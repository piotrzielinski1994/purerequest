use serde::Serialize;

use crate::pcap_capture::{
    CapturedPacket, PacketCapture, LINKTYPE_ETHERNET, LINKTYPE_LOOP, LINKTYPE_NULL,
};
use crate::tap_client::Capture;

// A network-stack dissection of one completed send, Wireshark-style: ordered layers, each
// carrying flat "facts" fields (things with no on-wire bytes we can show, like the socket
// endpoint) and byte-backed `segments` (a TLS record, an HTTP/2 frame) whose fields carry the
// exact byte/bit range they occupy so the UI can highlight them in a hex view. Decoded from the
// byte-level `Capture` the tap client records. Absent for sends with no capture.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Dissection {
    pub layers: Vec<Layer>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    // OSI layer number (1-7).
    pub osi: u8,
    // Stack label, e.g. "Network (IP)", "Presentation (TLS)", "Application (HTTP/2)".
    pub name: String,
    // One-line description of what this layer carried.
    pub summary: String,
    // How much of this layer we can actually see from a userspace client:
    // "decoded" = real bytes decoded here; "facts" = socket-derived facts only, no header bytes;
    // "unreachable" = needs privileged packet capture / hardware access we don't have.
    pub reach: Reach,
    // Facts with no byte backing (socket addresses, negotiated TLS params).
    pub fields: Vec<Field>,
    // Byte-backed decodables (TLS records, HTTP/2 frames), each with its own hex buffer.
    pub segments: Vec<Segment>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Reach {
    // Real wire bytes decoded here.
    Decoded,
    // Socket-derived facts only (endpoints), no header bytes without packet capture.
    Facts,
    // Observable, but only via a privileged capture driver (what Wireshark uses) - a
    // deliberate opt-out for an unprivileged app, not a hard limit.
    Privileged,
    // Not observable by any software (physical signalling).
    Unreachable,
}

// A byte-backed unit of one layer (one TLS record / one HTTP/2 frame / the HTTP/1.1 head). Its
// `hex` is the raw bytes; each field's `byteOffset`/`byteLength` index into these bytes.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub title: String,
    // Space-separated hex byte pairs of the whole segment (possibly truncated - see `truncated`).
    pub hex: String,
    // Total byte length of the segment on the wire (may exceed the bytes in `hex` if truncated).
    pub byte_len: usize,
    pub truncated: bool,
    pub fields: Vec<Field>,
}

// One decoded field. `byteOffset`/`byteLength` (when present) locate it in the parent segment's
// bytes; `bitOffset`/`bitLength` (when present) narrow it to a sub-byte bit range measured from
// the most-significant bit of the field's first byte (so a mask of 0x01 is bit offset 7). Fields
// may nest (`children`) - e.g. a flags byte with one child per flag bit.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub label: String,
    pub value: String,
    pub meaning: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_offset: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bit_offset: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bit_length: Option<usize>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Field>,
}

impl Field {
    pub(crate) fn fact(label: &str, value: impl Into<String>, meaning: &str) -> Self {
        Self {
            label: label.to_string(),
            value: value.into(),
            meaning: meaning.to_string(),
            ..Default::default()
        }
    }

    pub(crate) fn bytes(
        label: &str,
        value: impl Into<String>,
        meaning: &str,
        offset: usize,
        length: usize,
    ) -> Self {
        Self {
            label: label.to_string(),
            value: value.into(),
            meaning: meaning.to_string(),
            byte_offset: Some(offset),
            byte_length: Some(length),
            ..Default::default()
        }
    }

    fn with_children(mut self, children: Vec<Field>) -> Self {
        self.children = children;
        self
    }

    // A sub-byte bit field within the byte range [offset, offset+length): bit_offset counts from
    // the MSB of the first byte.
    pub(crate) fn bits(
        label: &str,
        value: impl Into<String>,
        meaning: &str,
        offset: usize,
        length: usize,
        bit_offset: usize,
        bit_length: usize,
    ) -> Self {
        Self {
            label: label.to_string(),
            value: value.into(),
            meaning: meaning.to_string(),
            byte_offset: Some(offset),
            byte_length: Some(length),
            bit_offset: Some(bit_offset),
            bit_length: Some(bit_length),
            ..Default::default()
        }
    }
}

// Cap on how many segments (records/frames) and bytes we decode per buffer, so a pathological
// transfer can't bloat the payload. Sized to fit realistic handshake records / frames whole
// (a TLS ServerHello flight or an HTTP/2 HEADERS frame is typically a few hundred bytes).
const MAX_SEGMENTS: usize = 64;
const MAX_SEGMENT_HEX_BYTES: usize = 2048;

// Convenience entry for callers/tests with no packet capture (facts-only lower layers).
#[cfg_attr(not(test), allow(dead_code))]
pub fn dissect(capture: &Capture) -> Option<Dissection> {
    dissect_with_packets(capture, &PacketCapture::default())
}

pub fn dissect_with_packets(capture: &Capture, packets: &PacketCapture) -> Option<Dissection> {
    // Nothing captured at all -> no dissection (parallels timings: no connection, nothing to show).
    if capture.peer_addr.is_none() && capture.tls_version.is_none() && capture.app_data_in.is_empty()
    {
        return None;
    }

    // If pcap handed us real packets, decode one representative packet's L2/L3/L4 headers to the
    // byte/bit level. Otherwise the lower layers stay facts-only (their default).
    let sample = packets.packets.first();

    // The full 7-layer OSI model, top (7) to bottom (1). We surface every layer and are honest
    // about how much of each a userspace HTTPS client can actually observe.
    let layers = vec![
        application_layer(capture),
        presentation_layer(capture),
        session_layer(capture),
        transport_layer(capture, sample),
        network_layer(capture, sample),
        data_link_layer(sample, packets.unavailable_reason.as_deref()),
        physical_layer(),
    ];
    Some(Dissection { layers })
}

fn hex_of(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

// ---------- OSI layer 7: Application (HTTP) ----------

fn application_layer(capture: &Capture) -> Layer {
    let is_h2 = capture.alpn.as_deref() == Some("h2");
    let (name, framing_fact, segments) = if is_h2 {
        (
            "Application (HTTP/2)",
            Field::fact(
                "Framing",
                "Binary frames",
                "HTTP/2 replaces text lines with length-prefixed binary frames multiplexed over one connection. Each 9-byte frame header carries a 24-bit length, an 8-bit type, an 8-bit flags field, and a reserved bit + 31-bit stream id.",
            ),
            {
                let mut s = decode_http2_frame_segments(&capture.app_data_out, "sent");
                s.extend(decode_http2_frame_segments(&capture.app_data_in, "received"));
                s
            },
        )
    } else {
        (
            "Application (HTTP/1.1)",
            Field::fact(
                "Framing",
                "Plain text",
                "HTTP/1.1 is a text protocol: a start line, then `Name: value` header lines, an empty line, then the body. The smallest unit is the line.",
            ),
            {
                let mut s = Vec::new();
                if let Some(seg) = http1_head_segment(&capture.app_data_out, "request") {
                    s.push(seg);
                }
                if let Some(seg) = http1_head_segment(&capture.app_data_in, "response") {
                    s.push(seg);
                }
                s
            },
        )
    };
    let summary = if segments.is_empty() {
        "Request/response semantics (payload encrypted or unavailable)".to_string()
    } else {
        format!("{} message(s) decoded", segments.len())
    };
    Layer {
        osi: 7,
        name: name.to_string(),
        summary,
        reach: if segments.is_empty() {
            Reach::Facts
        } else {
            Reach::Decoded
        },
        fields: vec![framing_fact],
        segments,
    }
}

// ---------- OSI layer 6: Presentation (TLS record/crypto) ----------

fn presentation_layer(capture: &Capture) -> Layer {
    match capture.tls_version.as_deref() {
        None => Layer {
            osi: 6,
            name: "Presentation".to_string(),
            summary: "None - plaintext HTTP, no encryption/encoding layer".to_string(),
            reach: Reach::Facts,
            fields: vec![Field::fact(
                "Encryption",
                "None (cleartext http)",
                "There is no presentation layer here: a plain `http://` connection carries the HTTP bytes directly over TCP with no TLS.",
            )],
            segments: Vec::new(),
        },
        Some(version) => {
            let mut fields = vec![Field::fact(
                "TLS Version",
                version,
                "The TLS protocol version negotiated in the handshake. TLS 1.3 is the modern default; 1.2 is the older widely-supported one.",
            )];
            if let Some(cipher) = capture.tls_cipher.as_deref() {
                fields.push(Field::fact(
                    "Cipher suite",
                    cipher,
                    "The agreed set of algorithms for key exchange, bulk encryption, and message authentication.",
                ));
            }
            let mut segments = decode_tls_record_segments(&capture.tls_records_in, "received");
            segments.extend(decode_tls_record_segments(&capture.tls_records_out, "sent"));
            Layer {
                osi: 6,
                name: "Presentation (TLS)".to_string(),
                summary: format!("Encrypted with {version}"),
                reach: Reach::Decoded,
                fields,
                segments,
            }
        }
    }
}

// ---------- OSI layer 5: Session (TLS session + ALPN) ----------

fn session_layer(capture: &Capture) -> Layer {
    let mut fields = Vec::new();
    match capture.alpn.as_deref() {
        Some(alpn) => fields.push(Field::fact(
            "ALPN",
            alpn,
            "Application-Layer Protocol Negotiation: the application protocol picked during the TLS handshake (h2 = HTTP/2, http/1.1 = HTTP/1.1). It establishes which application dialogue runs over this session.",
        )),
        None => fields.push(Field::fact(
            "ALPN",
            "not negotiated",
            "No application protocol was negotiated at the session layer (plaintext connection or a server that didn't offer ALPN).",
        )),
    }
    let established = capture.tls_version.is_some() || capture.peer_addr.is_some();
    fields.push(Field::fact(
        "Session",
        if established { "Established" } else { "None" },
        "HTTP keeps no long-lived session of its own; the TLS session (its keys + negotiated parameters) is what plays the OSI session role here - one connection, one dialogue.",
    ));
    Layer {
        osi: 5,
        name: "Session".to_string(),
        summary: "TLS session / ALPN (HTTP is otherwise stateless)".to_string(),
        reach: Reach::Facts,
        fields,
        segments: Vec::new(),
    }
}

// ---------- OSI layer 4: Transport (TCP) ----------

fn transport_layer(capture: &Capture, sample: Option<&CapturedPacket>) -> Layer {
    // Real TCP header decoded from a captured packet, when available.
    if let Some(segment) = sample.and_then(decode_tcp_segment) {
        return Layer {
            osi: 4,
            name: "Transport (TCP)".to_string(),
            summary: "TCP header decoded from captured packet".to_string(),
            reach: Reach::Decoded,
            fields: vec![Field::fact(
                "Protocol",
                "TCP",
                "A reliable, ordered, connection-oriented byte stream. HTTP always rides on TCP here.",
            )],
            segments: vec![segment],
        };
    }
    let mut fields = vec![Field::fact(
        "Protocol",
        "TCP",
        "A reliable, ordered, connection-oriented byte stream. HTTP always rides on TCP here.",
    )];
    if let Some(peer) = capture.peer_addr {
        fields.push(Field::fact(
            "Remote port",
            peer.port().to_string(),
            "The server's TCP port (443 for HTTPS, 80 for HTTP).",
        ));
    }
    if let Some(local) = capture.local_addr {
        fields.push(Field::fact(
            "Local port",
            local.port().to_string(),
            "The ephemeral source port the OS assigned to this connection.",
        ));
    }
    fields.push(Field::fact(
        "Header bytes",
        "not captured",
        "The real TCP header (sequence/ack numbers, window, SYN/ACK/FIN flags, checksum) lives in the kernel. Reading those bytes needs privileged packet capture (set PUREREQUEST_PCAP=1 and run with BPF access); otherwise only the socket endpoints above are shown.",
    ));
    Layer {
        osi: 4,
        name: "Transport (TCP)".to_string(),
        summary: "TCP endpoints (set PUREREQUEST_PCAP=1 for header bytes)".to_string(),
        reach: Reach::Facts,
        fields,
        segments: Vec::new(),
    }
}

// ---------- OSI layer 3: Network (IP) ----------

fn network_layer(capture: &Capture, sample: Option<&CapturedPacket>) -> Layer {
    network_layer_from(capture.peer_addr, capture.local_addr, sample)
}

// Address-driven network layer, shared with the QUIC dissector (which has its own capture type).
pub(crate) fn network_layer_from(
    peer_addr: Option<std::net::SocketAddr>,
    local_addr: Option<std::net::SocketAddr>,
    sample: Option<&CapturedPacket>,
) -> Layer {
    if let Some(segment) = sample.and_then(decode_ip_segment) {
        return Layer {
            osi: 3,
            name: "Network (IP)".to_string(),
            summary: "IP header decoded from captured packet".to_string(),
            reach: Reach::Decoded,
            fields: Vec::new(),
            segments: vec![segment],
        };
    }
    let mut fields = Vec::new();
    let reach = match peer_addr {
        Some(peer) => {
            let ip_version = if peer.is_ipv6() { "IPv6" } else { "IPv4" };
            fields.push(Field::fact(
                "IP version",
                ip_version,
                "Which Internet Protocol version carried the packets - IPv4 (32-bit addresses) or IPv6 (128-bit).",
            ));
            fields.push(Field::fact(
                "Remote address",
                peer.ip().to_string(),
                "The server's IP address, resolved from the host name.",
            ));
            if let Some(local) = local_addr {
                fields.push(Field::fact(
                    "Local address",
                    local.ip().to_string(),
                    "This machine's own IP address - the packet source.",
                ));
            }
            fields.push(Field::fact(
                "Header bytes",
                "not captured",
                "The real IP header (TTL, flags, fragment offset, protocol, checksum) is set by the kernel. Decoding those bytes needs privileged packet capture (set PUREREQUEST_PCAP=1 with BPF access); otherwise only the addresses are shown.",
            ));
            Reach::Facts
        }
        None => {
            fields.push(Field::fact(
                "Addresses",
                "not available",
                "No connection was established, so no IP endpoints were observed.",
            ));
            Reach::Unreachable
        }
    };
    Layer {
        osi: 3,
        name: "Network (IP)".to_string(),
        summary: "IP addresses (set PUREREQUEST_PCAP=1 for header bytes)".to_string(),
        reach,
        fields,
        segments: Vec::new(),
    }
}

// ---------- OSI layer 2: Data Link (Ethernet/Wi-Fi) ----------

pub(crate) fn data_link_layer(sample: Option<&CapturedPacket>, unavailable_reason: Option<&str>) -> Layer {
    if let Some(segment) = sample.and_then(decode_link_segment) {
        return Layer {
            osi: 2,
            name: "Data Link".to_string(),
            summary: "Link-layer header decoded from captured packet".to_string(),
            reach: Reach::Decoded,
            fields: Vec::new(),
            segments: vec![segment],
        };
    }
    // Capture was attempted (PUREREQUEST_PCAP=1) but couldn't start - surface why.
    let frames_field = match unavailable_reason {
        Some(reason) => Field::fact(
            "Frames",
            "capture unavailable",
            &format!("Packet capture was requested but couldn't start: {reason}. On macOS, BPF devices are root-only; install Wireshark's ChmodBPF helper or launch with elevated privileges to decode this layer."),
        ),
        None => Field::fact(
            "Frames",
            "not captured here",
            "MAC addresses and Ethernet/Wi-Fi frame headers live below the IP stack. They ARE observable - this is exactly what Wireshark shows - but only via a privileged packet-capture path (libpcap/npcap plus root, a kernel driver, or BPF access). Set PUREREQUEST_PCAP=1 and run with BPF access to decode this layer; otherwise purerequest stays a normal unprivileged app and skips it.",
        ),
    };
    Layer {
        osi: 2,
        name: "Data Link".to_string(),
        summary: "Ethernet / Wi-Fi frames - capturable only with a privileged packet-capture driver".to_string(),
        reach: Reach::Privileged,
        fields: vec![frames_field],
        segments: Vec::new(),
    }
}

// ---------- OSI layer 1: Physical - not observable by software (even Wireshark stops at L2) ----------

pub(crate) fn physical_layer() -> Layer {
    Layer {
        osi: 1,
        name: "Physical".to_string(),
        summary: "Electrical/optical/radio signalling - hardware, no software sees it".to_string(),
        reach: Reach::Unreachable,
        fields: vec![Field::fact(
            "Medium",
            "not observable",
            "The physical layer is the actual signals on copper, fiber, or radio. No software observes these - not even Wireshark, whose lowest captured unit is the Data Link frame the NIC hands up. The signalling itself is handled entirely by the network hardware.",
        )],
        segments: Vec::new(),
    }
}

// ---------- Captured-packet decoders (L2/L3/L4 real header bytes, via pcap) ----------

// The byte offset where the IP header starts, given the pcap linktype. Ethernet has a 14-byte
// header (2x6 MAC + 2 ethertype); the loopback linktypes (NULL/LOOP) carry a 4-byte pseudo-
// header (address family). Returns None for a linktype we don't handle.
fn l3_offset(linktype: i32) -> Option<usize> {
    match linktype {
        LINKTYPE_ETHERNET => Some(14),
        LINKTYPE_NULL | LINKTYPE_LOOP => Some(4),
        _ => None,
    }
}

fn decode_link_segment(packet: &CapturedPacket) -> Option<Segment> {
    match packet.linktype {
        LINKTYPE_ETHERNET => decode_ethernet(&packet.data),
        LINKTYPE_NULL | LINKTYPE_LOOP => decode_loopback(&packet.data),
        _ => None,
    }
}

fn mac(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn decode_ethernet(data: &[u8]) -> Option<Segment> {
    if data.len() < 14 {
        return None;
    }
    let ethertype = u16::from_be_bytes([data[12], data[13]]);
    let ethertype_name = match ethertype {
        0x0800 => "IPv4",
        0x86dd => "IPv6",
        0x0806 => "ARP",
        _ => "other",
    };
    let (hex, truncated) = truncated_hex(&data[..14]);
    Some(Segment {
        title: "Ethernet II frame".to_string(),
        hex,
        byte_len: 14,
        truncated,
        fields: vec![
            Field::bytes(
                "Destination MAC",
                mac(&data[0..6]),
                "The hardware (MAC) address of the next hop on the local link - usually the default gateway/router, not the final server.",
                0,
                6,
            ),
            Field::bytes(
                "Source MAC",
                mac(&data[6..12]),
                "This machine's network-interface hardware address.",
                6,
                6,
            ),
            Field::bytes(
                "EtherType",
                format!("0x{ethertype:04x} ({ethertype_name})"),
                "Identifies the upper-layer protocol carried in the frame payload (0x0800 = IPv4, 0x86dd = IPv6).",
                12,
                2,
            ),
        ],
    })
}

fn decode_loopback(data: &[u8]) -> Option<Segment> {
    if data.len() < 4 {
        return None;
    }
    // The loopback pseudo-header is a 4-byte address family, host byte order (commonly LE on
    // macOS): 2 = AF_INET (IPv4), 30 = AF_INET6.
    let family = u32::from_ne_bytes([data[0], data[1], data[2], data[3]]);
    let family_name = match family {
        2 => "AF_INET (IPv4)",
        30 => "AF_INET6 (IPv6)",
        _ => "other",
    };
    let (hex, truncated) = truncated_hex(&data[..4]);
    Some(Segment {
        title: "Loopback pseudo-header".to_string(),
        hex,
        byte_len: 4,
        truncated,
        fields: vec![Field::bytes(
            "Address family",
            format!("{family} ({family_name})"),
            "Loopback (localhost) traffic has no real Ethernet frame - the capture driver prepends a 4-byte address-family tag instead of MAC addresses.",
            0,
            4,
        )],
    })
}

fn decode_ip_segment(packet: &CapturedPacket) -> Option<Segment> {
    let offset = l3_offset(packet.linktype)?;
    let ip = packet.data.get(offset..)?;
    if ip.is_empty() {
        return None;
    }
    match ip[0] >> 4 {
        4 => decode_ipv4(ip),
        6 => decode_ipv6(ip),
        _ => None,
    }
}

fn decode_ipv4(ip: &[u8]) -> Option<Segment> {
    if ip.len() < 20 {
        return None;
    }
    let ihl_words = ip[0] & 0x0f;
    let header_len = ihl_words as usize * 4;
    let total_len = u16::from_be_bytes([ip[2], ip[3]]);
    let ttl = ip[8];
    let protocol = ip[9];
    let protocol_name = match protocol {
        6 => "TCP",
        17 => "UDP",
        1 => "ICMP",
        _ => "other",
    };
    let src = format!("{}.{}.{}.{}", ip[12], ip[13], ip[14], ip[15]);
    let dst = format!("{}.{}.{}.{}", ip[16], ip[17], ip[18], ip[19]);
    let flags = ip[6] >> 5;
    let show = header_len.min(ip.len()).max(20);
    let (hex, truncated) = truncated_hex(&ip[..show]);
    Some(Segment {
        title: "IPv4 header".to_string(),
        hex,
        byte_len: header_len,
        truncated,
        fields: vec![
            Field::bits(
                "Version",
                "4",
                "The IP version - here IPv4. It occupies the high 4 bits of the first byte.",
                0,
                1,
                0,
                4,
            ),
            Field::bits(
                "IHL",
                format!("{ihl_words} words ({header_len} bytes)"),
                "Internet Header Length: the header size in 32-bit words (low 4 bits of byte 0).",
                0,
                1,
                4,
                4,
            ),
            Field::bytes(
                "Total Length",
                format!("{total_len} bytes"),
                "The entire IP packet length (header + payload) in bytes.",
                2,
                2,
            ),
            Field::bits(
                "Flags",
                format!("0x{flags:x}"),
                "The 3-bit IP flags (Reserved, Don't Fragment, More Fragments) in the high bits of byte 6.",
                6,
                1,
                0,
                3,
            ),
            Field::bytes(
                "TTL",
                ttl.to_string(),
                "Time To Live: max router hops before the packet is dropped. Decremented by each router; a low value on a received packet hints at the network distance.",
                8,
                1,
            ),
            Field::bytes(
                "Protocol",
                format!("{protocol} ({protocol_name})"),
                "The upper-layer protocol in the payload (6 = TCP, 17 = UDP).",
                9,
                1,
            ),
            Field::bytes(
                "Source address",
                src,
                "The packet's origin IP address.",
                12,
                4,
            ),
            Field::bytes(
                "Destination address",
                dst,
                "The packet's destination IP address.",
                16,
                4,
            ),
        ],
    })
}

fn decode_ipv6(ip: &[u8]) -> Option<Segment> {
    if ip.len() < 40 {
        return None;
    }
    let payload_len = u16::from_be_bytes([ip[4], ip[5]]);
    let next_header = ip[6];
    let next_name = match next_header {
        6 => "TCP",
        17 => "UDP",
        58 => "ICMPv6",
        _ => "other",
    };
    let hop_limit = ip[7];
    let (hex, truncated) = truncated_hex(&ip[..40]);
    Some(Segment {
        title: "IPv6 header".to_string(),
        hex,
        byte_len: 40,
        truncated,
        fields: vec![
            Field::bits(
                "Version",
                "6",
                "The IP version - here IPv6 (high 4 bits of the first byte).",
                0,
                1,
                0,
                4,
            ),
            Field::bytes(
                "Payload Length",
                format!("{payload_len} bytes"),
                "Length of the payload following the fixed 40-byte IPv6 header.",
                4,
                2,
            ),
            Field::bytes(
                "Next Header",
                format!("{next_header} ({next_name})"),
                "The protocol of the next header (the IPv6 analogue of IPv4's Protocol field).",
                6,
                1,
            ),
            Field::bytes(
                "Hop Limit",
                hop_limit.to_string(),
                "IPv6's equivalent of TTL: max hops before the packet is dropped.",
                7,
                1,
            ),
        ],
    })
}

fn decode_tcp_segment(packet: &CapturedPacket) -> Option<Segment> {
    let l3 = l3_offset(packet.linktype)?;
    let ip = packet.data.get(l3..)?;
    if ip.is_empty() {
        return None;
    }
    let (tcp_offset, protocol) = match ip[0] >> 4 {
        4 => {
            if ip.len() < 20 {
                return None;
            }
            (l3 + (ip[0] & 0x0f) as usize * 4, ip[9])
        }
        6 => {
            if ip.len() < 40 {
                return None;
            }
            (l3 + 40, ip[6])
        }
        _ => return None,
    };
    if protocol != 6 {
        return None;
    }
    let tcp = packet.data.get(tcp_offset..)?;
    if tcp.len() < 20 {
        return None;
    }
    let src_port = u16::from_be_bytes([tcp[0], tcp[1]]);
    let dst_port = u16::from_be_bytes([tcp[2], tcp[3]]);
    let seq = u32::from_be_bytes([tcp[4], tcp[5], tcp[6], tcp[7]]);
    let ack = u32::from_be_bytes([tcp[8], tcp[9], tcp[10], tcp[11]]);
    let data_offset_words = tcp[12] >> 4;
    let header_len = data_offset_words as usize * 4;
    let flags_byte = tcp[13];
    let window = u16::from_be_bytes([tcp[14], tcp[15]]);
    let show = header_len.min(tcp.len()).max(20);
    let (hex, truncated) = truncated_hex(&tcp[..show]);
    Some(Segment {
        title: format!("TCP segment ({src_port} -> {dst_port})"),
        hex,
        byte_len: header_len,
        truncated,
        fields: vec![
            Field::bytes(
                "Source Port",
                src_port.to_string(),
                "The sending endpoint's TCP port.",
                0,
                2,
            ),
            Field::bytes(
                "Destination Port",
                dst_port.to_string(),
                "The receiving endpoint's TCP port (443 = HTTPS).",
                2,
                2,
            ),
            Field::bytes(
                "Sequence Number",
                seq.to_string(),
                "Byte-stream position of the first data byte in this segment - how TCP orders and reassembles the stream.",
                4,
                4,
            ),
            Field::bytes(
                "Acknowledgment Number",
                ack.to_string(),
                "The next sequence number the sender expects to receive - confirms delivery of everything before it.",
                8,
                4,
            ),
            Field::bits(
                "Data Offset",
                format!("{data_offset_words} words ({header_len} bytes)"),
                "The TCP header length in 32-bit words (high 4 bits of byte 12) - tells where the payload begins.",
                12,
                1,
                0,
                4,
            ),
            Field::bytes(
                "Flags",
                format!("0x{flags_byte:02x}  {}", bit_string(flags_byte)),
                "The TCP control bits. Each bit is a distinct signal (see below) - SYN opens a connection, ACK confirms data, FIN closes, RST aborts.",
                13,
                1,
            )
            .with_children(tcp_flag_bits(flags_byte)),
            Field::bytes(
                "Window Size",
                window.to_string(),
                "How many more bytes the sender is willing to receive right now - TCP's flow-control back-pressure.",
                14,
                2,
            ),
        ],
    })
}

fn tcp_flag_bits(flags: u8) -> Vec<Field> {
    // (mask, name, meaning). The 8 low bits of the flags byte; bit offset from MSB = 7 - log2(mask).
    const DEFS: &[(u8, &str, &str)] = &[
        (0x80, "CWR", "Congestion Window Reduced."),
        (0x40, "ECE", "ECN-Echo (explicit congestion notification)."),
        (0x20, "URG", "The Urgent pointer field is significant."),
        (0x10, "ACK", "The Acknowledgment number is significant - set on all but the first SYN."),
        (0x08, "PSH", "Push: deliver the buffered data to the application immediately."),
        (0x04, "RST", "Reset: abort the connection."),
        (0x02, "SYN", "Synchronize sequence numbers - opens a connection (the handshake)."),
        (0x01, "FIN", "Finish: no more data; begin closing this direction."),
    ];
    DEFS.iter()
        .map(|(mask, name, meaning)| {
            let bit_from_msb = 7 - mask.trailing_zeros() as usize;
            let set = flags & mask != 0;
            Field::bits(
                name,
                if set { "1 (set)" } else { "0 (clear)" },
                meaning,
                0,
                1,
                bit_from_msb,
                1,
            )
        })
        .collect()
}

// ---------- TLS records (byte-level: only the 5-byte record header is cleartext) ----------

fn decode_tls_record_segments(bytes: &[u8], direction: &str) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut offset = 0usize;
    while offset + 5 <= bytes.len() && segments.len() < MAX_SEGMENTS {
        let content_type = bytes[offset];
        if !matches!(content_type, 20..=24) {
            break;
        }
        let major = bytes[offset + 1];
        let minor = bytes[offset + 2];
        let length = u16::from_be_bytes([bytes[offset + 3], bytes[offset + 4]]);
        let total = 5 + length as usize;
        let end = (offset + total).min(bytes.len());
        let record_bytes = &bytes[offset..end];
        let (hex, truncated) = truncated_hex(record_bytes);

        let fields = vec![
            Field::bytes(
                "Content Type",
                format!("{} ({content_type})", tls_record_type_name(content_type)),
                "The record type. Handshake sets up the session; ApplicationData carries the encrypted payload; Alert signals a warning/fatal error.",
                0,
                1,
            ),
            Field::bytes(
                "Legacy Version",
                format!("{}.{} (0x{major:02x}{minor:02x})", major, minor),
                "The record-layer protocol version. In TLS 1.3 this is pinned to 0x0303 (TLS 1.2) for middlebox compatibility; the real version is negotiated in the ClientHello extensions.",
                1,
                2,
            ),
            Field::bytes(
                "Length",
                format!("{length} bytes"),
                "Byte length of the record payload that follows this 5-byte header.",
                3,
                2,
            ),
        ];

        let mut segment = Segment {
            title: format!(
                "TLS record ({direction}): {}",
                tls_record_type_name(content_type)
            ),
            hex,
            byte_len: total,
            truncated,
            fields,
        };
        // The first Handshake record is a plaintext ClientHello (sent) / ServerHello (received);
        // decode its handshake header. Later handshake records are encrypted in TLS 1.3.
        let handshake = if content_type == 22 {
            decode_handshake_header(record_bytes)
        } else {
            None
        };
        match handshake {
            Some(child) => segment.fields.push(child),
            None if record_bytes.len() > 5 => {
                // No structured decode for this payload (encrypted app-data, ChangeCipherSpec,
                // Alert, or a later encrypted handshake) - expose the raw payload bytes so every
                // byte of the record is accounted for and highlightable.
                let payload_len = record_bytes.len() - 5;
                segment.fields.push(Field::bytes(
                    "Payload",
                    payload_meaning_value(content_type, payload_len),
                    payload_meaning(content_type),
                    5,
                    payload_len,
                ));
            }
            None => {}
        }
        segments.push(segment);
        offset += total;
    }
    segments
}

// The 4-byte TLS Handshake message header sitting at the start of a Handshake record payload
// (byte 5 onward): 1-byte msg_type + 3-byte length. Plaintext for the very first flight.
fn decode_handshake_header(record: &[u8]) -> Option<Field> {
    if record.len() < 6 {
        return None;
    }
    let msg_type = record[5];
    let name = handshake_type_name(msg_type);
    // Only annotate types we recognize as plaintext-at-start; skip if it looks encrypted.
    if name == "Unknown" {
        return None;
    }
    let length_bytes = record.get(6..9);
    let mut children = vec![Field::bytes(
        "Handshake Type",
        format!("{name} ({msg_type})"),
        "Which handshake message this is. ClientHello proposes parameters; ServerHello selects them.",
        5,
        1,
    )];
    if let Some(len) = length_bytes {
        let length = u32::from_be_bytes([0, len[0], len[1], len[2]]);
        children.push(Field::bytes(
            "Handshake Length",
            format!("{length} bytes"),
            "Byte length of the handshake message body.",
            6,
            3,
        ));
    }
    Some(
        Field::bytes(
            "Handshake",
            name,
            "The TLS handshake message carried in this (plaintext) record.",
            5,
            record.len().saturating_sub(5),
        )
        .with_children(children),
    )
}

// ---------- HTTP/2 frame decode (bit-level: frames are cleartext above the TLS layer) ----------

fn decode_http2_frame_segments(bytes: &[u8], direction: &str) -> Vec<Segment> {
    const PREFACE: &[u8] = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";
    let mut segments = Vec::new();
    let mut offset = 0usize;
    // HPACK is stateful per direction: the dynamic table built while decoding earlier frames feeds
    // later indexed references, so one table lives across all frames in this buffer.
    let mut hpack_table = crate::hpack::DynamicTable::default();
    if bytes.starts_with(PREFACE) {
        let preface_bytes = &bytes[..PREFACE.len()];
        let (hex, truncated) = truncated_hex(preface_bytes);
        segments.push(Segment {
            title: format!("HTTP/2 connection preface ({direction})"),
            hex,
            byte_len: PREFACE.len(),
            truncated,
            fields: vec![Field::bytes(
                "Preface",
                "PRI * HTTP/2.0\\r\\n\\r\\nSM\\r\\n\\r\\n",
                "The fixed 24-byte string every HTTP/2 client sends first to confirm the connection really speaks h2 before any frames.",
                0,
                PREFACE.len(),
            )],
        });
        offset += PREFACE.len();
    }

    while offset + 9 <= bytes.len() && segments.len() < MAX_SEGMENTS {
        let length =
            u32::from_be_bytes([0, bytes[offset], bytes[offset + 1], bytes[offset + 2]]) as usize;
        let frame_type = bytes[offset + 3];
        let flags = bytes[offset + 4];
        let stream_id = u32::from_be_bytes([
            bytes[offset + 5] & 0x7f,
            bytes[offset + 6],
            bytes[offset + 7],
            bytes[offset + 8],
        ]);
        let reserved_bit = bytes[offset + 5] >> 7;
        let total = 9 + length;
        let end = (offset + total).min(bytes.len());
        let frame_bytes = &bytes[offset..end];
        let (hex, truncated) = truncated_hex(frame_bytes);
        let type_name = http2_frame_type_name(frame_type);

        let mut fields = vec![
            Field::bytes(
                "Length",
                format!("{length} bytes"),
                "24-bit length of the frame payload following this 9-byte header.",
                0,
                3,
            ),
            Field::bytes(
                "Type",
                format!("{type_name} ({frame_type})"),
                "The frame type: HEADERS carries (HPACK-compressed) request/response headers, DATA the body, SETTINGS/WINDOW_UPDATE manage the connection.",
                3,
                1,
            ),
            Field::bytes(
                "Flags",
                format!("0x{flags:02x}  {}", bit_string(flags)),
                "An 8-bit field of per-type boolean flags - each bit is a distinct signal (see the bits below).",
                4,
                1,
            )
            .with_children(http2_flag_bits(frame_type, flags)),
            Field::bits(
                "Reserved (R)",
                reserved_bit.to_string(),
                "A single reserved bit, the high bit of the stream-id word. Must be 0 and ignored on receipt.",
                5,
                4,
                0,
                1,
            ),
            Field::bits(
                "Stream Identifier",
                stream_id.to_string(),
                "The 31-bit stream this frame belongs to. Stream 0 is the whole connection (SETTINGS, PING, GOAWAY); odd numbers are client-initiated request streams.",
                5,
                4,
                1,
                31,
            ),
        ];
        if frame_type == 4 && flags & 0x1 == 0 {
            fields.extend(decode_settings_payload(frame_bytes, length));
        }
        // HEADERS (1), PUSH_PROMISE (5), CONTINUATION (9) carry an HPACK-compressed header block.
        if matches!(frame_type, 1 | 5 | 9) {
            if let Some(field) =
                decode_header_block_field(frame_bytes, length, frame_type, flags, &mut hpack_table)
            {
                fields.push(field);
            }
        }

        segments.push(Segment {
            title: format!("HTTP/2 frame ({direction}): {type_name}, stream {stream_id}"),
            hex,
            byte_len: total,
            truncated,
            fields,
        });
        offset += total;
    }
    segments
}

// Decode the HPACK header block inside a HEADERS/PUSH_PROMISE/CONTINUATION frame into a parent
// "Header block (HPACK)" field with one byte-located child per decoded header. Skips the frame's
// PADDED (pad-length byte) and PRIORITY (5-byte dependency+weight) prefixes so the block starts at
// the right offset, and offsets each child inside the whole frame segment (past the 9-byte header).
fn decode_header_block_field(
    frame_bytes: &[u8],
    length: usize,
    frame_type: u8,
    flags: u8,
    table: &mut crate::hpack::DynamicTable,
) -> Option<Field> {
    const FRAME_HEADER_LEN: usize = 9;
    let payload_end = (FRAME_HEADER_LEN + length).min(frame_bytes.len());
    let mut block_start = FRAME_HEADER_LEN;
    let is_padded = flags & 0x08 != 0;
    // PUSH_PROMISE (5) has no PRIORITY flag; only HEADERS (1) carries a 0x20 PRIORITY prefix.
    let has_priority = frame_type == 1 && flags & 0x20 != 0;

    let mut padding = 0usize;
    if is_padded {
        padding = *frame_bytes.get(block_start)? as usize;
        block_start += 1;
    }
    if has_priority {
        block_start += 5;
    }
    // PUSH_PROMISE prefixes the block with a 4-byte promised-stream-id.
    if frame_type == 5 {
        block_start += 4;
    }
    let block_end = payload_end.saturating_sub(padding).max(block_start);
    let block = frame_bytes.get(block_start..block_end)?;
    if block.is_empty() {
        return None;
    }

    let decoded = crate::hpack::decode_block(block, table);
    if decoded.is_empty() {
        return None;
    }
    let children = decoded
        .into_iter()
        .map(|header| {
            let value = if header.name.is_empty() {
                format!("dynamic table size update ({})", header.value)
            } else {
                format!("{}: {}", header.name, header.value)
            };
            Field::bytes(
                "Header",
                value,
                hpack_repr_meaning(header.kind),
                block_start + header.byte_offset,
                header.byte_len,
            )
        })
        .collect::<Vec<_>>();

    Some(
        Field::bytes(
            "Header block (HPACK)",
            format!("{} header(s)", children.len()),
            "The HPACK-compressed (RFC 7541) header block. Each header is an indexed reference into the static/dynamic tables or a literal name/value (optionally Huffman-coded), decoded here to plaintext.",
            block_start,
            block_end.saturating_sub(block_start),
        )
        .with_children(children),
    )
}

fn hpack_repr_meaning(kind: crate::hpack::HeaderRepr) -> &'static str {
    use crate::hpack::HeaderRepr;
    match kind {
        HeaderRepr::Indexed => "An indexed header field: the whole name+value came from a single entry in the static or dynamic table (1 byte on the wire).",
        HeaderRepr::LiteralIndexed => "A literal header field with incremental indexing: sent as name+value and also added to the dynamic table for later reuse.",
        HeaderRepr::LiteralNoIndex => "A literal header field without indexing: sent as name+value for this message only, not added to the dynamic table.",
        HeaderRepr::LiteralNeverIndexed => "A literal header field never indexed: like without-indexing, but marked so intermediaries must not add it to any table (for sensitive values).",
        HeaderRepr::SizeUpdate => "A dynamic table size update: not a header, but a signal changing the maximum size of the HPACK dynamic table.",
    }
}

// SETTINGS payload = a run of 6-byte entries (16-bit identifier + 32-bit value), all cleartext.
fn decode_settings_payload(frame: &[u8], length: usize) -> Vec<Field> {
    let mut fields = Vec::new();
    let payload_end = (9 + length).min(frame.len());
    let mut offset = 9usize;
    while offset + 6 <= payload_end {
        let id = u16::from_be_bytes([frame[offset], frame[offset + 1]]);
        let value = u32::from_be_bytes([
            frame[offset + 2],
            frame[offset + 3],
            frame[offset + 4],
            frame[offset + 5],
        ]);
        fields.push(Field::bytes(
            settings_id_name(id),
            format!("{value}"),
            "One SETTINGS parameter: a 16-bit identifier and its 32-bit value.",
            offset,
            6,
        ));
        offset += 6;
    }
    fields
}

fn http2_flag_bits(frame_type: u8, flags: u8) -> Vec<Field> {
    // (mask, name, meaning) per frame type. Bit offset from MSB = 7 - log2(mask).
    let defs: &[(u8, &str, &str)] = match frame_type {
        0 => &[
            (0x01, "END_STREAM", "This DATA frame is the last for the stream (half-closes it)."),
            (0x08, "PADDED", "The payload is prefixed with a pad-length byte and trailing padding."),
        ],
        1 => &[
            (0x01, "END_STREAM", "This HEADERS frame is the last for the stream."),
            (0x04, "END_HEADERS", "This frame completes the header block (no CONTINUATION follows)."),
            (0x08, "PADDED", "The header block is padded."),
            (0x20, "PRIORITY", "An exclusive/dependency/weight priority block is present."),
        ],
        4 => &[(0x01, "ACK", "Acknowledges the peer's SETTINGS frame (payload must be empty).")],
        6 => &[(0x01, "ACK", "This PING is a reply to a peer PING with the same opaque data.")],
        _ => &[],
    };
    defs.iter()
        .map(|(mask, name, meaning)| {
            let bit_from_msb = 7 - mask.trailing_zeros() as usize;
            let set = flags & mask != 0;
            Field::bits(
                name,
                if set { "1 (set)" } else { "0 (clear)" },
                meaning,
                4,
                1,
                bit_from_msb,
                1,
            )
        })
        .collect()
}

// ---------- HTTP/1.1 head decode (text: byte offsets, no sub-byte bits) ----------

fn http1_head_segment(bytes: &[u8], kind: &str) -> Option<Segment> {
    let head_end = find_subslice(bytes, b"\r\n\r\n")
        .map(|index| index + 4)
        .unwrap_or(bytes.len());
    let head = &bytes[..head_end];
    let text = String::from_utf8_lossy(head);
    let mut lines = text.split("\r\n").filter(|line| !line.is_empty());
    let start_line = lines.next()?.trim().to_string();
    if start_line.is_empty() {
        return None;
    }

    let (hex, truncated) = truncated_hex(head);
    let start_len = start_line.len();
    let start_label = if kind == "request" {
        "Request line"
    } else {
        "Status line"
    };
    let start_meaning = if kind == "request" {
        "The client's first line: method, request target (path), and HTTP version."
    } else {
        "The server's first line: HTTP version, numeric status code, and reason phrase."
    };
    let mut fields = vec![Field::bytes(start_label, start_line, start_meaning, 0, start_len)];

    // Each subsequent header line, located by its byte offset in the head.
    let mut cursor = start_len + 2; // past the start line's CRLF
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        fields.push(Field::bytes(
            "Header",
            trimmed.to_string(),
            "A single request/response header line (`Name: value`), sent verbatim as text.",
            cursor,
            line.len(),
        ));
        cursor += line.len() + 2;
    }

    Some(Segment {
        title: format!("HTTP/1.1 {kind} head"),
        hex,
        byte_len: head.len(),
        truncated,
        fields,
    })
}

// ---------- helpers ----------

fn truncated_hex(bytes: &[u8]) -> (String, bool) {
    if bytes.len() <= MAX_SEGMENT_HEX_BYTES {
        return (hex_of(bytes), false);
    }
    (hex_of(&bytes[..MAX_SEGMENT_HEX_BYTES]), true)
}

// An 8-char MSB-first bit pattern, e.g. 0x05 -> "00000101".
fn bit_string(byte: u8) -> String {
    (0..8)
        .map(|i| if byte & (0x80 >> i) != 0 { '1' } else { '0' })
        .collect()
}

fn tls_record_type_name(content_type: u8) -> &'static str {
    match content_type {
        20 => "ChangeCipherSpec",
        21 => "Alert",
        22 => "Handshake",
        23 => "ApplicationData",
        24 => "Heartbeat",
        _ => "Unknown",
    }
}

fn payload_meaning_value(content_type: u8, len: usize) -> String {
    match content_type {
        20 => format!("ChangeCipherSpec ({len} byte)"),
        23 => format!("{len} encrypted bytes"),
        _ => format!("{len} bytes"),
    }
}

fn payload_meaning(content_type: u8) -> &'static str {
    match content_type {
        20 => "The ChangeCipherSpec message - a single legacy 0x01 byte signalling the switch to encrypted records (kept in TLS 1.3 only for middlebox compatibility; it carries no real meaning).",
        23 => "The encrypted application-data payload. Its plaintext is inside the TLS session and cannot be shown from the record bytes alone.",
        21 => "The Alert payload (encrypted in TLS 1.3) - a warning or fatal error signal.",
        _ => "The record payload following the 5-byte header (encrypted).",
    }
}

fn handshake_type_name(msg_type: u8) -> &'static str {
    match msg_type {
        1 => "ClientHello",
        2 => "ServerHello",
        11 => "Certificate",
        _ => "Unknown",
    }
}

fn http2_frame_type_name(frame_type: u8) -> &'static str {
    match frame_type {
        0 => "DATA",
        1 => "HEADERS",
        2 => "PRIORITY",
        3 => "RST_STREAM",
        4 => "SETTINGS",
        5 => "PUSH_PROMISE",
        6 => "PING",
        7 => "GOAWAY",
        8 => "WINDOW_UPDATE",
        9 => "CONTINUATION",
        _ => "Unknown",
    }
}

fn settings_id_name(id: u16) -> &'static str {
    match id {
        0x1 => "HEADER_TABLE_SIZE",
        0x2 => "ENABLE_PUSH",
        0x3 => "MAX_CONCURRENT_STREAMS",
        0x4 => "INITIAL_WINDOW_SIZE",
        0x5 => "MAX_FRAME_SIZE",
        0x6 => "MAX_HEADER_LIST_SIZE",
        _ => "Setting",
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};

    fn capture_with_peer() -> Capture {
        Capture {
            peer_addr: Some(SocketAddr::new(IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)), 443)),
            local_addr: Some(SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)), 51234)),
            ..Default::default()
        }
    }

    fn layer(dissection: &Dissection, osi: u8) -> &Layer {
        dissection
            .layers
            .iter()
            .find(|l| l.osi == osi)
            .expect("layer present")
    }

    #[test]
    fn should_return_none_if_nothing_was_captured() {
        assert!(dissect(&Capture::default()).is_none());
    }

    #[test]
    fn should_always_present_all_seven_osi_layers() {
        let dissection = dissect(&capture_with_peer()).expect("layers");
        assert_eq!(dissection.layers.len(), 7);
        // Ordered top (7) to bottom (1).
        let osis: Vec<u8> = dissection.layers.iter().map(|l| l.osi).collect();
        assert_eq!(osis, vec![7, 6, 5, 4, 3, 2, 1]);
        // The two hardware layers are honestly marked unreachable.
        // L2 is capturable with a privileged driver (Wireshark's path); L1 truly isn't.
        assert_eq!(layer(&dissection, 2).reach, Reach::Privileged);
        assert_eq!(layer(&dissection, 1).reach, Reach::Unreachable);
    }

    #[test]
    fn should_decode_the_network_layer_facts_from_the_peer_address() {
        let dissection = dissect(&capture_with_peer()).expect("layers");
        let network = layer(&dissection, 3);
        assert!(network.name.contains("Network"));
        assert!(network.segments.is_empty(), "network layer has no byte segments");
        assert!(network
            .fields
            .iter()
            .any(|f| f.label == "Remote address" && f.value == "93.184.216.34"));
        assert_eq!(network.reach, Reach::Facts);
    }

    #[test]
    fn should_mark_the_presentation_layer_as_plaintext_for_a_non_tls_capture() {
        let dissection = dissect(&capture_with_peer()).expect("layers");
        let presentation = layer(&dissection, 6);
        assert!(presentation.segments.is_empty());
        assert!(presentation
            .fields
            .iter()
            .any(|f| f.value.to_lowercase().contains("none")));
    }

    #[test]
    fn should_decode_a_tls_record_header_to_the_byte_level() {
        let mut capture = capture_with_peer();
        capture.tls_version = Some("TLSv1_3".to_string());
        // ApplicationData record (type 23), legacy version 0x0303, length 2, then 2 payload bytes.
        capture.tls_records_in = vec![23, 3, 3, 0, 2, 0xaa, 0xbb];

        let dissection = dissect(&capture).expect("layers");
        let tls = layer(&dissection, 6);
        assert_eq!(tls.reach, Reach::Decoded);
        let record = &tls.segments[0];
        assert_eq!(record.byte_len, 7);
        assert_eq!(record.hex, "17 03 03 00 02 aa bb");

        let content_type = &record.fields[0];
        assert_eq!(content_type.label, "Content Type");
        assert_eq!(content_type.byte_offset, Some(0));
        assert_eq!(content_type.byte_length, Some(1));
        assert!(content_type.value.contains("ApplicationData"));

        let length = record.fields.iter().find(|f| f.label == "Length").unwrap();
        assert_eq!(length.byte_offset, Some(3));
        assert_eq!(length.byte_length, Some(2));
        assert_eq!(length.value, "2 bytes");
    }

    #[test]
    fn should_decode_a_clienthello_handshake_header_inside_the_first_record() {
        let mut capture = capture_with_peer();
        capture.tls_version = Some("TLSv1_3".to_string());
        // Handshake record (22), version 0x0303, length 4; payload = ClientHello (1) + 3-byte len 1.
        capture.tls_records_out = vec![22, 3, 3, 0, 4, 1, 0, 0, 1, 0];

        let dissection = dissect(&capture).expect("layers");
        let tls = layer(&dissection, 6);
        let record = tls
            .segments
            .iter()
            .find(|s| s.title.contains("sent"))
            .expect("sent record");
        let handshake = record
            .fields
            .iter()
            .find(|f| f.label == "Handshake")
            .expect("handshake field");
        let hs_type = handshake
            .children
            .iter()
            .find(|f| f.label == "Handshake Type")
            .unwrap();
        assert!(hs_type.value.contains("ClientHello"));
        assert_eq!(hs_type.byte_offset, Some(5));
    }

    #[test]
    fn should_decode_an_http2_headers_frame_to_per_flag_bits() {
        let mut capture = capture_with_peer();
        capture.tls_version = Some("TLSv1_3".to_string());
        capture.alpn = Some("h2".to_string());
        // HEADERS frame (type 1), flags = END_STREAM|END_HEADERS = 0x05, stream 1, length 0.
        capture.app_data_out = vec![0, 0, 0, 1, 0x05, 0, 0, 0, 1];

        let dissection = dissect(&capture).expect("layers");
        let http = layer(&dissection, 7);
        let frame = &http.segments[0];

        let flags = frame.fields.iter().find(|f| f.label == "Flags").unwrap();
        assert!(flags.value.contains("0x05"));
        assert!(flags.value.contains("00000101"));

        let end_stream = flags
            .children
            .iter()
            .find(|f| f.label == "END_STREAM")
            .expect("END_STREAM bit");
        assert_eq!(end_stream.bit_length, Some(1));
        assert_eq!(end_stream.bit_offset, Some(7)); // mask 0x01 -> MSB offset 7
        assert!(end_stream.value.contains("set"));

        let end_headers = flags
            .children
            .iter()
            .find(|f| f.label == "END_HEADERS")
            .expect("END_HEADERS bit");
        assert_eq!(end_headers.bit_offset, Some(5)); // mask 0x04 -> MSB offset 5
        assert!(end_headers.value.contains("set"));

        let padded = flags.children.iter().find(|f| f.label == "PADDED").unwrap();
        assert!(padded.value.contains("clear"));
    }

    // Flatten a frame segment's fields plus one level of children, so a decoded HPACK header can
    // be found whether it sits directly on the frame or nested under a "Header block (HPACK)"
    // parent field.
    fn find_hpack_header<'a>(frame: &'a Segment, needle: &str) -> Option<&'a Field> {
        frame
            .fields
            .iter()
            .flat_map(|field| std::iter::once(field).chain(field.children.iter()))
            .find(|field| {
                let combined = format!("{} {}", field.label, field.value);
                combined.contains(needle) && combined.contains("GET")
            })
    }

    // AC-008 - behavior: a plain HEADERS frame carrying HPACK block `82` decodes `:method: GET` into
    // a byte-located header field; byteOffset/byteLength point at the representation inside the
    // frame segment (block starts at the 9-byte frame header, so offset 9, length 1).
    #[test]
    fn should_byte_locate_a_decoded_hpack_header_within_the_http2_frame() {
        let mut capture = capture_with_peer();
        capture.tls_version = Some("TLSv1_3".to_string());
        capture.alpn = Some("h2".to_string());
        // HEADERS frame (type 1), flags END_HEADERS (0x04), stream 1, length 1, block = `82`.
        capture.app_data_out = vec![0, 0, 1, 1, 0x04, 0, 0, 0, 1, 0x82];

        let dissection = dissect(&capture).expect("layers");
        let http = layer(&dissection, 7);
        let frame = &http.segments[0];

        let header = find_hpack_header(frame, ":method")
            .expect("a decoded :method: GET header field under the HEADERS frame");
        assert_eq!(header.byte_offset, Some(9), "block starts after the 9-byte frame header");
        assert_eq!(header.byte_length, Some(1), "the indexed `82` representation is one byte");
    }

    // AC-007 - behavior: PADDED + PRIORITY prefixes on a HEADERS frame are skipped so the HPACK
    // block is decoded from the correct offset. Payload = pad-length(1) + priority(5) + block `82` +
    // padding(2); the `82` sits at frame offset 9 + 1 + 5 = 15 and must still decode to `:method: GET`.
    #[test]
    fn should_skip_padded_and_priority_prefixes_before_decoding_the_header_block() {
        let mut capture = capture_with_peer();
        capture.tls_version = Some("TLSv1_3".to_string());
        capture.alpn = Some("h2".to_string());
        // flags = PADDED (0x08) | PRIORITY (0x20) | END_HEADERS (0x04) = 0x2c, stream 1, length 9.
        capture.app_data_out = vec![
            0, 0, 9, 1, 0x2c, 0, 0, 0, 1, // 9-byte frame header
            0x02, // pad length = 2
            0, 0, 0, 0, 0, // 5-byte priority (stream dependency + weight)
            0x82, // HPACK block: indexed `:method: GET`
            0xaa, 0xbb, // 2 bytes of padding
        ];

        let dissection = dissect(&capture).expect("layers");
        let http = layer(&dissection, 7);
        let frame = &http.segments[0];

        let header = find_hpack_header(frame, ":method")
            .expect("`:method: GET` decoded from past the PADDED + PRIORITY prefixes");
        // 9 (frame header) + 1 (pad length) + 5 (priority) = 15.
        assert_eq!(header.byte_offset, Some(15), "block offset must skip the pad-length + priority prefixes");
    }

    #[test]
    fn should_split_the_reserved_bit_from_the_31_bit_stream_id() {
        let mut capture = capture_with_peer();
        capture.tls_version = Some("TLSv1_3".to_string());
        capture.alpn = Some("h2".to_string());
        // DATA frame, stream id word = 0x80000003 (reserved bit set + stream 3).
        capture.app_data_in = vec![0, 0, 0, 0, 0, 0x80, 0, 0, 3];

        let dissection = dissect(&capture).unwrap();
        let http = layer(&dissection, 7);
        let frame = &http.segments[0];

        let reserved = frame
            .fields
            .iter()
            .find(|f| f.label == "Reserved (R)")
            .unwrap();
        assert_eq!(reserved.bit_offset, Some(0));
        assert_eq!(reserved.bit_length, Some(1));
        assert_eq!(reserved.value, "1");

        let stream = frame
            .fields
            .iter()
            .find(|f| f.label == "Stream Identifier")
            .unwrap();
        assert_eq!(stream.bit_offset, Some(1));
        assert_eq!(stream.bit_length, Some(31));
        assert_eq!(stream.value, "3"); // reserved bit masked off
    }

    #[test]
    fn should_decode_settings_frame_payload_entries() {
        let mut capture = capture_with_peer();
        capture.tls_version = Some("TLSv1_3".to_string());
        capture.alpn = Some("h2".to_string());
        // SETTINGS frame, length 6, one entry: MAX_CONCURRENT_STREAMS (0x3) = 100.
        capture.app_data_out = vec![0, 0, 6, 4, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 100];

        let dissection = dissect(&capture).unwrap();
        let http = layer(&dissection, 7);
        let frame = &http.segments[0];
        let setting = frame
            .fields
            .iter()
            .find(|f| f.label == "MAX_CONCURRENT_STREAMS")
            .expect("decoded setting");
        assert_eq!(setting.value, "100");
        assert_eq!(setting.byte_offset, Some(9));
        assert_eq!(setting.byte_length, Some(6));
    }

    #[test]
    fn should_decode_the_http2_connection_preface() {
        let mut capture = capture_with_peer();
        capture.tls_version = Some("TLSv1_3".to_string());
        capture.alpn = Some("h2".to_string());
        let mut sent = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n".to_vec();
        sent.extend_from_slice(&[0, 0, 0, 4, 0, 0, 0, 0, 0]); // SETTINGS
        capture.app_data_out = sent;

        let dissection = dissect(&capture).unwrap();
        let http = layer(&dissection, 7);
        assert!(http.segments[0].title.contains("preface"));
        assert!(http.segments[1].title.contains("SETTINGS"));
    }

    #[test]
    fn should_decode_the_http1_head_with_byte_located_lines() {
        let mut capture = capture_with_peer();
        // No TLS version -> plaintext http; no alpn -> http/1.1 path.
        capture.app_data_out = b"GET /widgets HTTP/1.1\r\nHost: example.com\r\n\r\n".to_vec();
        capture.app_data_in =
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}".to_vec();

        let dissection = dissect(&capture).unwrap();
        let http = layer(&dissection, 7);
        assert!(http.name.contains("HTTP/1.1"));
        let request = http
            .segments
            .iter()
            .find(|s| s.title.contains("request"))
            .unwrap();
        let request_line = &request.fields[0];
        assert_eq!(request_line.label, "Request line");
        assert_eq!(request_line.value, "GET /widgets HTTP/1.1");
        assert_eq!(request_line.byte_offset, Some(0));
        assert_eq!(request_line.byte_length, Some("GET /widgets HTTP/1.1".len()));

        let host = request
            .fields
            .iter()
            .find(|f| f.value == "Host: example.com")
            .expect("host header");
        // "GET /widgets HTTP/1.1" (21) + CRLF (2) = offset 23.
        assert_eq!(host.byte_offset, Some(23));
    }

    #[test]
    fn should_stop_decoding_tls_records_at_an_implausible_type() {
        let records = decode_tls_record_segments(&[22, 3, 3, 0, 1, 7, 0xff, 0xff, 0xff], "received");
        assert_eq!(records.len(), 1);
    }

    #[test]
    fn should_expose_the_record_payload_bytes_so_every_byte_is_accounted_for() {
        // ChangeCipherSpec record (type 20), length 1, payload byte 0x01.
        let records = decode_tls_record_segments(&[20, 3, 3, 0, 1, 1], "received");
        let payload = records[0]
            .fields
            .iter()
            .find(|f| f.label == "Payload")
            .expect("payload field covers the trailing byte");
        assert_eq!(payload.byte_offset, Some(5));
        assert_eq!(payload.byte_length, Some(1));

        // ApplicationData record (type 23), 2 encrypted payload bytes -> also exposed.
        let app = decode_tls_record_segments(&[23, 3, 3, 0, 2, 0xaa, 0xbb], "received");
        let app_payload = app[0]
            .fields
            .iter()
            .find(|f| f.label == "Payload")
            .expect("app-data payload field");
        assert_eq!(app_payload.byte_offset, Some(5));
        assert_eq!(app_payload.byte_length, Some(2));
    }

    // A real Ethernet + IPv4 + TCP packet: 14B Ethernet, 20B IPv4 (TTL 64, proto 6),
    // 20B TCP (ports 51234->443, SYN+ACK flags 0x12).
    fn ethernet_ipv4_tcp_packet() -> CapturedPacket {
        let mut data = Vec::new();
        // Ethernet: dst MAC, src MAC, ethertype IPv4.
        data.extend_from_slice(&[0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
        data.extend_from_slice(&[0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
        data.extend_from_slice(&[0x08, 0x00]);
        // IPv4: version 4 + IHL 5, dscp, total len 40, id, flags/frag, TTL 64, proto 6 (TCP),
        // checksum, src 192.168.1.10, dst 93.184.216.34.
        data.extend_from_slice(&[0x45, 0x00, 0x00, 0x28, 0x00, 0x00, 0x40, 0x00, 64, 6, 0x00, 0x00]);
        data.extend_from_slice(&[192, 168, 1, 10]);
        data.extend_from_slice(&[93, 184, 216, 34]);
        // TCP: src 51234, dst 443, seq, ack, data offset 5 (0x50), flags 0x12 (SYN+ACK), window 65535.
        data.extend_from_slice(&[0xc8, 0x22, 0x01, 0xbb]);
        data.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]);
        data.extend_from_slice(&[0x00, 0x00, 0x00, 0x02]);
        data.extend_from_slice(&[0x50, 0x12, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00]);
        CapturedPacket {
            linktype: LINKTYPE_ETHERNET,
            data,
        }
    }

    #[test]
    fn should_decode_the_ethernet_frame_header() {
        let segment = decode_link_segment(&ethernet_ipv4_tcp_packet()).expect("ethernet");
        assert_eq!(segment.title, "Ethernet II frame");
        let dst = segment.fields.iter().find(|f| f.label == "Destination MAC").unwrap();
        assert_eq!(dst.value, "aa:bb:cc:dd:ee:ff");
        assert_eq!(dst.byte_offset, Some(0));
        assert_eq!(dst.byte_length, Some(6));
        let ethertype = segment.fields.iter().find(|f| f.label == "EtherType").unwrap();
        assert!(ethertype.value.contains("IPv4"));
    }

    #[test]
    fn should_decode_the_ipv4_header_fields() {
        let segment = decode_ip_segment(&ethernet_ipv4_tcp_packet()).expect("ipv4");
        assert_eq!(segment.title, "IPv4 header");
        let ttl = segment.fields.iter().find(|f| f.label == "TTL").unwrap();
        assert_eq!(ttl.value, "64");
        let proto = segment.fields.iter().find(|f| f.label == "Protocol").unwrap();
        assert!(proto.value.contains("TCP"));
        let dst = segment.fields.iter().find(|f| f.label == "Destination address").unwrap();
        assert_eq!(dst.value, "93.184.216.34");
        // Version is a bit field in the high nibble of byte 0.
        let version = segment.fields.iter().find(|f| f.label == "Version").unwrap();
        assert_eq!(version.bit_offset, Some(0));
        assert_eq!(version.bit_length, Some(4));
    }

    #[test]
    fn should_decode_the_tcp_header_and_split_flag_bits() {
        let segment = decode_tcp_segment(&ethernet_ipv4_tcp_packet()).expect("tcp");
        let dst_port = segment.fields.iter().find(|f| f.label == "Destination Port").unwrap();
        assert_eq!(dst_port.value, "443");
        let seq = segment.fields.iter().find(|f| f.label == "Sequence Number").unwrap();
        assert_eq!(seq.value, "1");

        let flags = segment.fields.iter().find(|f| f.label == "Flags").unwrap();
        // 0x12 = SYN (0x02) + ACK (0x10).
        let syn = flags.children.iter().find(|f| f.label == "SYN").unwrap();
        assert!(syn.value.contains("set"));
        assert_eq!(syn.bit_offset, Some(6)); // mask 0x02 -> MSB offset 6
        let ack = flags.children.iter().find(|f| f.label == "ACK").unwrap();
        assert!(ack.value.contains("set"));
        assert_eq!(ack.bit_offset, Some(3)); // mask 0x10 -> MSB offset 3
        let fin = flags.children.iter().find(|f| f.label == "FIN").unwrap();
        assert!(fin.value.contains("clear"));
    }

    #[test]
    fn should_upgrade_lower_layers_to_decoded_when_packets_are_present() {
        let mut capture = capture_with_peer();
        capture.tls_version = Some("TLSv1_3".to_string());
        let packets = crate::pcap_capture::PacketCapture {
            packets: vec![ethernet_ipv4_tcp_packet()],
            unavailable_reason: None,
        };
        let dissection = dissect_with_packets(&capture, &packets).expect("layers");
        // L2/L3/L4 are now decoded from real bytes (not facts-only).
        assert_eq!(layer(&dissection, 2).reach, Reach::Decoded);
        assert_eq!(layer(&dissection, 3).reach, Reach::Decoded);
        assert_eq!(layer(&dissection, 4).reach, Reach::Decoded);
        assert!(!layer(&dissection, 4).segments.is_empty());
    }

    #[test]
    fn should_decode_the_loopback_pseudo_header() {
        // AF_INET (2) in little-endian, then a minimal IPv4+TCP so the family tag is exercised.
        let mut data = vec![2, 0, 0, 0];
        data.extend_from_slice(&[0x45, 0, 0, 40, 0, 0, 0, 0, 64, 6, 0, 0, 127, 0, 0, 1, 127, 0, 0, 1]);
        let packet = CapturedPacket {
            linktype: LINKTYPE_NULL,
            data,
        };
        let segment = decode_link_segment(&packet).expect("loopback");
        assert!(segment.title.contains("Loopback"));
        let family = segment.fields.iter().find(|f| f.label == "Address family").unwrap();
        assert!(family.value.contains("IPv4"));
    }
}
