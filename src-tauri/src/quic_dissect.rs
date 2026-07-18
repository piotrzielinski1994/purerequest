// Full byte-level QUIC / HTTP-3 dissection (RFC 9000 transport, RFC 9001 crypto, RFC 9114 HTTP/3,
// RFC 9204 QPACK). Turns the tapped UDP datagrams + exported TLS secrets of one `QuicCapture` into
// the same layered `Dissection` the Protocols tab renders for the TCP/TLS/HTTP-2 path.
//
// What it decodes: QUIC long/short packet headers (byte-located), Initial packets decrypted with
// the version-salt-derived keys (deterministic, no secret needed), Handshake/1-RTT packets
// decrypted with the keylog-exported secrets, their frames (CRYPTO/STREAM/ACK/…), CRYPTO
// reassembled into TLS handshake messages, and STREAM data parsed into HTTP/3 frames with
// QPACK-decoded HEADERS. Best-effort throughout: missing keys or malformed bytes leave a packet's
// payload marked encrypted rather than failing the whole dissection (it never panics or returns
// None once any datagram was captured).
//
// Deliberate scope limits (a single request never exercises them, so they'd be untested code):
// - Packet numbers use the on-wire truncated value directly; no largest-acked reconstruction (the
//   PN stays small within one request, where truncated == full). The key-phase bit IS decoded and
//   shown, but a key update mid-connection isn't tracked - a flipped phase would just fail the AEAD
//   tag and mark the packet encrypted (honest), never mis-decrypt.
// - QPACK dynamic-table references are structurally decoded but not value-resolved (a fresh request
//   uses the static table + literals). See qpack.rs.
#![allow(dead_code)]

use crate::dissect::{Dissection, Field, Layer, Reach, Segment};
use crate::pcap_capture::PacketCapture;
use crate::qpack;
use crate::quic_crypto::{self, Suite};
use crate::quic_client::QuicCapture;

const MAX_SEGMENTS: usize = 64;
const MAX_SEGMENT_HEX_BYTES: usize = 2048;

// One parsed QUIC packet from a datagram: its header bytes, the packet-type, and (when decryptable)
// its decrypted frame payload.
struct ParsedPacket {
    kind: PacketKind,
    // The full on-wire packet bytes (header + protected payload), for the hex segment.
    raw: Vec<u8>,
    // Byte offset + length of the header within `raw` (unprotected after HP removal).
    header_len: usize,
    version: Option<u32>,
    dcid: Vec<u8>,
    scid: Vec<u8>,
    packet_number: Option<u64>,
    // Byte offset of the packet-number field within `raw`, and its length (1-4) once HP is removed.
    pn_offset: usize,
    pn_len: Option<usize>,
    // The first byte after header-protection removal (carries the decoded key-phase bit).
    unprotected_first_byte: Option<u8>,
    // Decrypted frame bytes, if the packet could be opened.
    plaintext: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PacketKind {
    Initial,
    ZeroRtt,
    Handshake,
    Retry,
    VersionNegotiation,
    OneRtt,
}

impl PacketKind {
    fn label(self) -> &'static str {
        match self {
            PacketKind::Initial => "Initial",
            PacketKind::ZeroRtt => "0-RTT",
            PacketKind::Handshake => "Handshake",
            PacketKind::Retry => "Retry",
            PacketKind::VersionNegotiation => "Version Negotiation",
            PacketKind::OneRtt => "1-RTT",
        }
    }
}

// Entry point: build the QUIC dissection for one h3 send. Returns None only when nothing at all was
// captured (parallels the tap path: no connection -> nothing to show).
pub fn dissect_quic(capture: &QuicCapture, packets: &PacketCapture) -> Option<Dissection> {
    if capture.peer_addr.is_none() && capture.datagrams_out.is_empty() && capture.datagrams_in.is_empty()
    {
        return None;
    }

    // The client's first Initial DCID keys the initial secrets (RFC 9001 §5.2). It's the DCID of
    // the first outbound long-header packet.
    let initial_dcid = capture
        .datagrams_out
        .iter()
        .find_map(|datagram| first_long_header_dcid(datagram));

    // A short-header packet carries no connection-ID length on the wire, so the reader must know
    // it out of band. The client's SCID length (from its first Initial) is the DCID length of the
    // server's 1-RTT packets to the client; the server's SCID length is the DCID length of the
    // client's 1-RTT packets. Track both so packet-number decoding lands at the right offset.
    let client_cid_len = capture
        .datagrams_out
        .iter()
        .find_map(|datagram| first_long_header_scid_len(datagram))
        .unwrap_or(0);
    let server_cid_len = capture
        .datagrams_in
        .iter()
        .find_map(|datagram| first_long_header_scid_len(datagram))
        .unwrap_or(0);

    let secrets = SecretSet::from_keylog(&capture.keylog);

    let mut parsed_out = Vec::new();
    for datagram in &capture.datagrams_out {
        parsed_out.extend(parse_datagram(
            datagram,
            initial_dcid.as_deref(),
            &secrets,
            true,
            server_cid_len,
        ));
    }
    let mut parsed_in = Vec::new();
    for datagram in &capture.datagrams_in {
        parsed_in.extend(parse_datagram(
            datagram,
            initial_dcid.as_deref(),
            &secrets,
            false,
            client_cid_len,
        ));
    }

    let sample = packets.packets.first();
    let layers = vec![
        application_layer(&parsed_out, &parsed_in),
        crypto_layer(&parsed_out, &parsed_in, capture),
        transport_layer(&parsed_out, &parsed_in, capture),
        udp_layer(capture),
        crate::dissect::network_layer_from(capture.peer_addr, capture.local_addr, sample),
        crate::dissect::data_link_layer(sample, packets.unavailable_reason.as_deref()),
        crate::dissect::physical_layer(),
    ];
    Some(Dissection { layers })
}

// ---------- QUIC packet parsing ----------

// The DCID of the first long-header packet in a datagram (the client's chosen Initial DCID).
fn first_long_header_dcid(datagram: &[u8]) -> Option<Vec<u8>> {
    if datagram.len() < 6 || datagram[0] & 0x80 == 0 {
        return None;
    }
    let dcid_len = datagram[5] as usize;
    datagram.get(6..6 + dcid_len).map(|slice| slice.to_vec())
}

// The SCID length of the first long-header packet in a datagram (the sender's own connection ID
// length, which is the DCID length the peer puts on its short-header packets back).
fn first_long_header_scid_len(datagram: &[u8]) -> Option<usize> {
    if datagram.len() < 6 || datagram[0] & 0x80 == 0 {
        return None;
    }
    let dcid_len = datagram[5] as usize;
    let scid_len_offset = 6 + dcid_len;
    datagram.get(scid_len_offset).map(|len| *len as usize)
}

// Split a datagram into its coalesced packets and parse each (RFC 9000 §12.2: multiple packets may
// be coalesced in one datagram; each long header carries its own length).
fn parse_datagram(
    datagram: &[u8],
    initial_dcid: Option<&[u8]>,
    secrets: &SecretSet,
    from_client: bool,
    dest_cid_len: usize,
) -> Vec<ParsedPacket> {
    let mut packets = Vec::new();
    let mut offset = 0usize;
    while offset < datagram.len() {
        let remaining = &datagram[offset..];
        if remaining[0] & 0x80 == 0 {
            // Short header (1-RTT): runs to the end of the datagram (not length-prefixed).
            if let Some(packet) = parse_short_packet(remaining, secrets, from_client, dest_cid_len) {
                packets.push(packet);
            }
            break;
        }
        let (packet, consumed) = match parse_long_packet(remaining, initial_dcid, secrets, from_client)
        {
            Some(result) => result,
            None => break,
        };
        packets.push(packet);
        if consumed == 0 {
            break;
        }
        offset += consumed;
    }
    packets
}

fn read_varint(bytes: &[u8], offset: &mut usize) -> Option<u64> {
    let first = *bytes.get(*offset)?;
    let len = 1usize << (first >> 6);
    let mut value = (first & 0x3f) as u64;
    for i in 1..len {
        value = (value << 8) | *bytes.get(*offset + i)? as u64;
    }
    *offset += len;
    Some(value)
}

// Parse one long-header packet, returning it plus the number of bytes it consumed in the datagram.
fn parse_long_packet(
    bytes: &[u8],
    initial_dcid: Option<&[u8]>,
    secrets: &SecretSet,
    from_client: bool,
) -> Option<(ParsedPacket, usize)> {
    if bytes.len() < 7 {
        return None;
    }
    let first = bytes[0];
    let version = u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]);

    if version == 0 {
        // Version Negotiation: no length, consumes the rest of the datagram.
        let packet = ParsedPacket {
            kind: PacketKind::VersionNegotiation,
            raw: bytes.to_vec(),
            header_len: bytes.len(),
            version: Some(0),
            dcid: Vec::new(),
            scid: Vec::new(),
            packet_number: None,
            pn_offset: 0,
            pn_len: None,
            unprotected_first_byte: None,
            plaintext: None,
        };
        return Some((packet, bytes.len()));
    }

    let mut offset = 5usize;
    let dcid_len = *bytes.get(offset)? as usize;
    offset += 1;
    let dcid = bytes.get(offset..offset + dcid_len)?.to_vec();
    offset += dcid_len;
    let scid_len = *bytes.get(offset)? as usize;
    offset += 1;
    let scid = bytes.get(offset..offset + scid_len)?.to_vec();
    offset += scid_len;

    let long_type = (first & 0x30) >> 4;
    let kind = match long_type {
        0 => PacketKind::Initial,
        1 => PacketKind::ZeroRtt,
        2 => PacketKind::Handshake,
        _ => PacketKind::Retry,
    };

    if kind == PacketKind::Retry {
        // Retry: token + 16-byte integrity tag to the datagram end; no protected payload.
        let packet = ParsedPacket {
            kind,
            raw: bytes.to_vec(),
            header_len: bytes.len(),
            version: Some(version),
            dcid,
            scid,
            packet_number: None,
            pn_offset: 0,
            pn_len: None,
            unprotected_first_byte: None,
            plaintext: None,
        };
        return Some((packet, bytes.len()));
    }

    if kind == PacketKind::Initial {
        // Token (length-prefixed) precedes the packet Length field.
        let token_len = read_varint(bytes, &mut offset)? as usize;
        offset = offset.checked_add(token_len)?;
    }
    let length = read_varint(bytes, &mut offset)? as usize;
    let pn_offset = offset;
    let packet_end = pn_offset.checked_add(length)?;
    if packet_end > bytes.len() {
        return None;
    }

    // Choose keys: Initial from the version salt (deterministic, always AES-128-GCM); Handshake
    // from the keylog.
    let keys = match kind {
        PacketKind::Initial => initial_dcid.map(|dcid| PacketProtection {
            keys: quic_crypto::initial_keys_for(dcid, from_client),
            suite: Suite::Aes128Gcm,
        }),
        PacketKind::Handshake => secrets.handshake_keys(from_client),
        _ => None,
    };

    let raw = bytes[..packet_end].to_vec();
    let opened = open_packet(&raw, pn_offset, keys.as_ref(), false);

    let packet = ParsedPacket {
        kind,
        raw,
        header_len: opened.header_len,
        version: Some(version),
        dcid,
        scid,
        packet_number: opened.packet_number,
        pn_offset,
        pn_len: opened.pn_len,
        unprotected_first_byte: opened.unprotected_first_byte,
        plaintext: opened.plaintext,
    };
    Some((packet, packet_end))
}

fn parse_short_packet(
    bytes: &[u8],
    secrets: &SecretSet,
    from_client: bool,
    dest_cid_len: usize,
) -> Option<ParsedPacket> {
    // Short header: 1 byte flags + Destination Connection ID (whose length is not on the wire - it
    // is the peer's chosen CID length, tracked from the handshake), then the packet number.
    let keys = secrets.one_rtt_keys(from_client);
    let raw = bytes.to_vec();
    let pn_offset = 1 + dest_cid_len;
    let opened = open_packet(&raw, pn_offset, keys.as_ref(), true);
    Some(ParsedPacket {
        kind: PacketKind::OneRtt,
        raw,
        header_len: opened.header_len,
        version: None,
        dcid: Vec::new(),
        scid: Vec::new(),
        packet_number: opened.packet_number,
        pn_offset,
        // The key-phase bit is only meaningful after HP removal, so it's shown only when the
        // packet was opened (otherwise the bit is still masked and would mislead).
        pn_len: opened.pn_len,
        unprotected_first_byte: opened.unprotected_first_byte,
        plaintext: opened.plaintext,
    })
}

// The outcome of removing header protection + AEAD-opening one packet.
#[derive(Default)]
struct OpenedPacket {
    header_len: usize,
    packet_number: Option<u64>,
    pn_len: Option<usize>,
    unprotected_first_byte: Option<u8>,
    plaintext: Option<Vec<u8>>,
}

// Remove header protection + AEAD-open one packet (RFC 9001 §5.4). Without keys (or on a too-short
// sample), returns the protected header offset + None plaintext, so the packet still shows its
// visible header fields and is marked encrypted.
fn open_packet(
    raw: &[u8],
    pn_offset: usize,
    keys: Option<&PacketProtection>,
    short_header: bool,
) -> OpenedPacket {
    let encrypted = OpenedPacket {
        header_len: pn_offset,
        ..Default::default()
    };
    let Some(keys) = keys else {
        return encrypted;
    };
    // Sample starts 4 bytes into the (assumed 4-byte) packet-number field (RFC 9001 §5.4.2).
    let sample_offset = pn_offset + 4;
    let Some(sample) = raw.get(sample_offset..sample_offset + 16) else {
        return encrypted;
    };
    let mask = quic_crypto::header_protection_mask(&keys.keys.hp, sample, keys.suite);

    let mut header = raw.to_vec();
    if short_header {
        header[0] ^= mask[0] & 0x1f;
    } else {
        header[0] ^= mask[0] & 0x0f;
    }
    let pn_len = ((header[0] & 0x03) + 1) as usize;
    for i in 0..pn_len {
        if pn_offset + i >= header.len() {
            return encrypted;
        }
        header[pn_offset + i] ^= mask[1 + i];
    }
    let mut packet_number = 0u64;
    for i in 0..pn_len {
        packet_number = (packet_number << 8) | header[pn_offset + i] as u64;
    }
    let header_len = pn_offset + pn_len;

    let aad = &header[..header_len];
    let ciphertext = &raw[header_len..];
    let plaintext = quic_crypto::aead_open(
        &keys.keys.key,
        &keys.keys.iv,
        packet_number,
        aad,
        ciphertext,
        keys.suite,
    )
    .ok();

    OpenedPacket {
        header_len,
        packet_number: Some(packet_number),
        pn_len: Some(pn_len),
        unprotected_first_byte: Some(header[0]),
        plaintext,
    }
}

// ---------- Keys ----------

struct PacketProtection {
    keys: quic_crypto::PacketKeys,
    suite: Suite,
}

// The traffic secrets recovered from the SSLKEYLOGFILE lines quinn's rustls emitted.
struct SecretSet {
    client_handshake: Option<Vec<u8>>,
    server_handshake: Option<Vec<u8>>,
    client_app: Option<Vec<u8>>,
    server_app: Option<Vec<u8>>,
}

impl SecretSet {
    fn from_keylog(lines: &[String]) -> Self {
        let find = |label: &str| {
            lines.iter().find_map(|line| {
                let mut parts = line.split_whitespace();
                let found = parts.next()?;
                if found != label {
                    return None;
                }
                let _client_random = parts.next()?;
                let secret_hex = parts.next()?;
                hex_decode(secret_hex)
            })
        };
        Self {
            client_handshake: find("CLIENT_HANDSHAKE_TRAFFIC_SECRET"),
            server_handshake: find("SERVER_HANDSHAKE_TRAFFIC_SECRET"),
            client_app: find("CLIENT_TRAFFIC_SECRET_0"),
            server_app: find("SERVER_TRAFFIC_SECRET_0"),
        }
    }

    fn handshake_keys(&self, from_client: bool) -> Option<PacketProtection> {
        let secret = if from_client {
            self.client_handshake.as_ref()
        } else {
            self.server_handshake.as_ref()
        }?;
        Some(protection_for(secret))
    }

    fn one_rtt_keys(&self, from_client: bool) -> Option<PacketProtection> {
        let secret = if from_client {
            self.client_app.as_ref()
        } else {
            self.server_app.as_ref()
        }?;
        Some(protection_for(secret))
    }
}

// The suite isn't in the keylog line, so pick it by secret length: 48 bytes -> SHA-384 ->
// AES-256-GCM; 32 bytes -> SHA-256, which is AES-128-GCM or ChaCha20 (both derive 32-byte keys via
// SHA-256, and rustls' default TLS 1.3 suite for QUIC is AES-256 or ChaCha; AES-128 keys are 16).
// The AEAD tag check in `open_packet` is the real arbiter, so a mispick simply yields no plaintext.
fn protection_for(secret: &[u8]) -> PacketProtection {
    let suite = if secret.len() >= 48 {
        Suite::Aes256Gcm
    } else {
        Suite::Aes128Gcm
    };
    PacketProtection {
        keys: quic_crypto::derive_packet_keys(secret, suite),
        suite,
    }
}

fn hex_decode(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

// ---------- Layers ----------

fn hex_of(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take(MAX_SEGMENT_HEX_BYTES)
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

// OSI 7: HTTP/3 - frames parsed from decrypted 1-RTT STREAM data, HEADERS QPACK-decoded.
fn application_layer(out: &[ParsedPacket], inc: &[ParsedPacket]) -> Layer {
    let mut segments = Vec::new();
    for (packet, direction) in packets_with_direction(out, inc) {
        if packet.kind != PacketKind::OneRtt {
            continue;
        }
        let Some(plaintext) = &packet.plaintext else {
            continue;
        };
        segments.extend(http3_segments_from_frames(plaintext, direction));
        if segments.len() >= MAX_SEGMENTS {
            break;
        }
    }
    let reach = if segments.is_empty() {
        Reach::Facts
    } else {
        Reach::Decoded
    };
    let summary = if segments.is_empty() {
        "HTTP/3 (payload encrypted or no 1-RTT keys)".to_string()
    } else {
        format!("{} HTTP/3 frame(s) decoded", segments.len())
    };
    Layer {
        osi: 7,
        name: "Application (HTTP/3)".to_string(),
        summary,
        reach,
        fields: vec![Field::fact(
            "Framing",
            "HTTP/3 frames over QUIC streams",
            "HTTP/3 carries each request/response on its own QUIC stream as a series of typed frames (HEADERS, DATA), with headers compressed by QPACK. There is no head-of-line blocking across streams.",
        )],
        segments,
    }
}

// OSI 6/5: TLS 1.3 over QUIC - CRYPTO frames reassembled into handshake messages.
fn crypto_layer(out: &[ParsedPacket], inc: &[ParsedPacket], capture: &QuicCapture) -> Layer {
    let mut crypto = Vec::new();
    for (packet, _direction) in packets_with_direction(out, inc) {
        if let Some(plaintext) = &packet.plaintext {
            collect_crypto(plaintext, &mut crypto);
        }
    }
    crypto.sort_by_key(|(offset, _)| *offset);
    let reassembled: Vec<u8> = crypto.into_iter().flat_map(|(_, data)| data).collect();
    let segments = tls_handshake_segments(&reassembled);

    let has_keys = !capture.keylog.is_empty();
    let reach = if !segments.is_empty() {
        Reach::Decoded
    } else {
        Reach::Facts
    };
    let summary = if !segments.is_empty() {
        format!("TLS 1.3 handshake: {} message(s) decoded", segments.len())
    } else if has_keys {
        "TLS 1.3 over QUIC (handshake in Initial/Handshake packets)".to_string()
    } else {
        "TLS 1.3 over QUIC (secrets unavailable)".to_string()
    };
    Layer {
        osi: 6,
        name: "Presentation (TLS 1.3 over QUIC)".to_string(),
        summary,
        reach,
        fields: vec![Field::fact(
            "Encryption",
            "TLS 1.3 (in QUIC CRYPTO frames)",
            "QUIC carries the TLS 1.3 handshake inside CRYPTO frames rather than TLS records. The negotiated keys protect every QUIC packet; the same secrets (exported here via the key log) let this view decrypt them.",
        )],
        segments,
    }
}

// OSI 4: QUIC transport - one segment per parsed packet with byte-located header fields.
fn transport_layer(out: &[ParsedPacket], inc: &[ParsedPacket], capture: &QuicCapture) -> Layer {
    let mut segments = Vec::new();
    for (packet, direction) in packets_with_direction(out, inc) {
        segments.push(quic_packet_segment(packet, direction));
        if segments.len() >= MAX_SEGMENTS {
            break;
        }
    }
    let mut fields = vec![Field::fact(
        "Protocol",
        "QUIC (over UDP)",
        "QUIC is a reliable, multiplexed, always-encrypted transport running over UDP. It carries its own packet numbers, streams, and the TLS handshake, replacing TCP+TLS for HTTP/3.",
    )];
    if let Some(version) = capture.quic_version {
        fields.push(Field::fact(
            "Version",
            format!("0x{version:08x}"),
            "The negotiated QUIC version (0x00000001 is RFC 9000 QUIC v1).",
        ));
    }
    if let Some(alpn) = capture.alpn.as_deref() {
        fields.push(Field::fact(
            "ALPN",
            alpn,
            "The application protocol negotiated in the TLS handshake (h3 = HTTP/3).",
        ));
    }
    if let Some(cipher) = capture.tls_cipher.as_deref() {
        fields.push(Field::fact(
            "Cipher suite",
            cipher,
            "The TLS 1.3 cipher suite protecting the QUIC packets.",
        ));
    }
    Layer {
        osi: 4,
        name: "Transport (QUIC)".to_string(),
        summary: format!("{} QUIC packet(s) decoded", segments.len()),
        reach: Reach::Decoded,
        fields,
        segments,
    }
}

// OSI 4 (lower): UDP - datagram facts from the tap. The kernel UDP header bytes aren't decoded
// here (the pcap sample decoder is TCP-only today); the datagram counts + endpoints are the honest
// facts, so this layer is Facts, matching how the TCP path reports endpoints without PUREREQUEST_PCAP.
fn udp_layer(capture: &QuicCapture) -> Layer {
    let mut fields = vec![Field::fact(
        "Protocol",
        "UDP",
        "A connectionless datagram service. QUIC uses UDP so it can implement its own reliability and multiplexing in userspace.",
    )];
    if let Some(peer) = capture.peer_addr {
        fields.push(Field::fact(
            "Remote port",
            peer.port().to_string(),
            "The server's UDP port (443 for HTTP/3).",
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
        "Datagrams",
        format!(
            "{} sent, {} received",
            capture.datagrams_out.len(),
            capture.datagrams_in.len()
        ),
        "How many UDP datagrams the tap observed in each direction (each may coalesce several QUIC packets).",
    ));
    Layer {
        osi: 4,
        name: "Transport (UDP)".to_string(),
        summary: "UDP endpoints (set PUREREQUEST_PCAP=1 for header bytes)".to_string(),
        reach: Reach::Facts,
        fields,
        segments: Vec::new(),
    }
}

fn packets_with_direction<'a>(
    out: &'a [ParsedPacket],
    inc: &'a [ParsedPacket],
) -> Vec<(&'a ParsedPacket, &'static str)> {
    out.iter()
        .map(|packet| (packet, "sent"))
        .chain(inc.iter().map(|packet| (packet, "received")))
        .collect()
}

// A byte-located segment for one QUIC packet: version, DCID/SCID, packet number, key phase.
fn quic_packet_segment(packet: &ParsedPacket, direction: &str) -> Segment {
    let is_long = packet
        .raw
        .first()
        .map(|first| first & 0x80 != 0)
        .unwrap_or(false);
    let mut fields = vec![Field::bytes(
        "Header form",
        if is_long { "Long header" } else { "Short header" },
        "The high bit of the first byte: long-header packets (Initial/Handshake/…) carry version + connection IDs; short-header (1-RTT) packets are the steady-state form after the handshake.",
        0,
        1,
    )];
    if is_long {
        if let Some(version) = packet.version {
            fields.push(Field::bytes(
                "Version",
                format!("0x{version:08x}"),
                "The QUIC version this packet uses (bytes 1-4 of a long header).",
                1,
                4,
            ));
        }
        if !packet.dcid.is_empty() {
            // DCID length is byte 5; the DCID itself starts at byte 6.
            fields.push(Field::bytes(
                "Destination Connection ID",
                hex_compact(&packet.dcid),
                "The connection ID the recipient chose (or, for the first Initial, the client's random choice that keys the initial secrets).",
                6,
                packet.dcid.len(),
            ));
        }
        // SCID length byte, then the SCID, follow the DCID (RFC 9000 §17.2).
        let scid_offset = 6 + packet.dcid.len() + 1;
        if !packet.scid.is_empty() {
            fields.push(Field::bytes(
                "Source Connection ID",
                hex_compact(&packet.scid),
                "The connection ID the sender chose for itself; the peer echoes it as the Destination Connection ID on packets sent back.",
                scid_offset,
                packet.scid.len(),
            ));
        }
    }
    if let (Some(pn), Some(pn_len)) = (packet.packet_number, packet.pn_len) {
        // The packet number occupies pn_len bytes starting at the (unprotected) pn offset.
        fields.push(Field::bytes(
            "Packet number",
            pn.to_string(),
            "The packet's sequence number within its number space, decoded after removing header protection. Its byte length (1-4) is carried in the low 2 bits of the first byte.",
            packet.pn_offset,
            pn_len,
        ));
    } else if let Some(pn) = packet.packet_number {
        fields.push(Field::fact(
            "Packet number",
            pn.to_string(),
            "The packet's sequence number within its number space (decoded after removing header protection).",
        ));
    }
    if !is_long {
        // Short header: the key-phase bit (0x04 of the first byte) signals which 1-RTT key
        // generation protects the packet (RFC 9000 §17.3.1); it flips on a key update.
        if let Some(first) = packet.unprotected_first_byte {
            fields.push(Field::bits(
                "Key phase",
                ((first >> 2) & 1).to_string(),
                "The 1-RTT key-phase bit: which key generation protects this packet. It toggles on a key update; this view marks packets encrypted rather than mis-decrypting after a flip.",
                0,
                1,
                5,
                1,
            ));
        }
    }
    let decrypt_note = match &packet.plaintext {
        Some(_) => "decrypted",
        None => "encrypted (no key / not decryptable)",
    };
    fields.push(Field::fact(
        "Payload",
        decrypt_note,
        "Whether this view could remove packet protection and AEAD-decrypt the packet's frames.",
    ));

    let hex = hex_of(&packet.raw);
    Segment {
        title: format!("{} {} packet", direction, packet.kind.label()),
        hex,
        byte_len: packet.raw.len(),
        truncated: packet.raw.len() > MAX_SEGMENT_HEX_BYTES,
        fields,
    }
}

fn hex_compact(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// ---------- QUIC frames ----------

// Collect (offset, data) pairs from all CRYPTO frames in a decrypted payload (RFC 9000 §19.6).
fn collect_crypto(plaintext: &[u8], out: &mut Vec<(u64, Vec<u8>)>) {
    let mut offset = 0usize;
    while offset < plaintext.len() {
        let Some(frame_type) = read_varint_at(plaintext, &mut offset) else {
            break;
        };
        match frame_type {
            0x00 => continue,                 // PADDING
            0x01 => continue,                 // PING
            0x06 => {
                // CRYPTO: offset, length, data.
                let Some(crypto_offset) = read_varint_at(plaintext, &mut offset) else {
                    break;
                };
                let Some(length) = read_varint_at(plaintext, &mut offset) else {
                    break;
                };
                let end = offset + length as usize;
                let Some(data) = plaintext.get(offset..end) else {
                    break;
                };
                out.push((crypto_offset, data.to_vec()));
                offset = end;
            }
            0x02 | 0x03 => {
                // ACK: skip its fields (largest, delay, range count, first range, then ranges).
                if !skip_ack_frame(plaintext, &mut offset, frame_type == 0x03) {
                    break;
                }
            }
            _ => {
                // Unknown/other frame in the handshake flight: stop (best-effort).
                break;
            }
        }
    }
}

fn skip_ack_frame(bytes: &[u8], offset: &mut usize, ecn: bool) -> bool {
    let fields = if ecn { 4 } else { 3 };
    let mut range_count = None;
    for i in 0..fields {
        match read_varint_at(bytes, offset) {
            Some(value) => {
                if i == 2 {
                    range_count = Some(value);
                }
            }
            None => return false,
        }
    }
    if let Some(count) = range_count {
        for _ in 0..count {
            if read_varint_at(bytes, offset).is_none() || read_varint_at(bytes, offset).is_none() {
                return false;
            }
        }
    }
    if ecn {
        for _ in 0..3 {
            if read_varint_at(bytes, offset).is_none() {
                return false;
            }
        }
    }
    true
}

fn read_varint_at(bytes: &[u8], offset: &mut usize) -> Option<u64> {
    read_varint(bytes, offset)
}

// HTTP/3 frames from decrypted STREAM-frame payloads (RFC 9000 §19.8 STREAM -> RFC 9114 frames).
fn http3_segments_from_frames(plaintext: &[u8], direction: &str) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut offset = 0usize;
    while offset < plaintext.len() {
        let Some(frame_type) = read_varint_at(plaintext, &mut offset) else {
            break;
        };
        // STREAM frame types are 0x08-0x0f; the low 3 bits are OFF/LEN/FIN flags.
        if (0x08..=0x0f).contains(&frame_type) {
            let has_off = frame_type & 0x04 != 0;
            let has_len = frame_type & 0x02 != 0;
            let _stream_id = read_varint_at(plaintext, &mut offset);
            if has_off {
                read_varint_at(plaintext, &mut offset);
            }
            let stream_data = if has_len {
                let Some(len) = read_varint_at(plaintext, &mut offset) else {
                    break;
                };
                let end = offset + len as usize;
                let Some(data) = plaintext.get(offset..end) else {
                    break;
                };
                offset = end;
                data
            } else {
                let data = &plaintext[offset..];
                offset = plaintext.len();
                data
            };
            segments.extend(decode_http3_stream(stream_data, direction));
        } else {
            break;
        }
    }
    segments
}

// Decode the HTTP/3 frames carried in one stream's data (RFC 9114 §7.1).
fn decode_http3_stream(data: &[u8], direction: &str) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut offset = 0usize;
    while offset < data.len() {
        let frame_start = offset;
        let Some(frame_type) = read_varint_at(data, &mut offset) else {
            break;
        };
        let Some(length) = read_varint_at(data, &mut offset) else {
            break;
        };
        let end = offset + length as usize;
        let Some(payload) = data.get(offset..end) else {
            break;
        };
        let (title, fields) = match frame_type {
            0x00 => ("HTTP/3 DATA".to_string(), vec![Field::fact(
                "Body bytes",
                length.to_string(),
                "A DATA frame carries request/response body octets.",
            )]),
            0x01 => {
                let headers = qpack::decode_field_section(payload);
                let mut fields = vec![Field::fact(
                    "Header count",
                    headers.len().to_string(),
                    "A HEADERS frame carries the QPACK-encoded request/response header fields.",
                )];
                for header in headers.iter().take(32) {
                    fields.push(Field::fact(
                        &header.name,
                        header.value.clone(),
                        "A QPACK-decoded header field.",
                    ));
                }
                ("HTTP/3 HEADERS".to_string(), fields)
            }
            0x04 => ("HTTP/3 SETTINGS".to_string(), vec![Field::fact(
                "Type",
                "SETTINGS",
                "Connection-level HTTP/3 settings (sent on the control stream).",
            )]),
            other => (format!("HTTP/3 frame type 0x{other:x}"), Vec::new()),
        };
        let frame_bytes = &data[frame_start..end.min(data.len())];
        segments.push(Segment {
            title: format!("{direction} {title}"),
            hex: hex_of(frame_bytes),
            byte_len: frame_bytes.len(),
            truncated: frame_bytes.len() > MAX_SEGMENT_HEX_BYTES,
            fields,
        });
        offset = end;
    }
    segments
}

// ---------- TLS handshake ----------

// Split reassembled CRYPTO data into TLS 1.3 handshake-message segments (RFC 8446 §4).
fn tls_handshake_segments(data: &[u8]) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut offset = 0usize;
    while offset + 4 <= data.len() {
        let msg_type = data[offset];
        let length =
            ((data[offset + 1] as usize) << 16) | ((data[offset + 2] as usize) << 8) | data[offset + 3] as usize;
        let end = offset + 4 + length;
        if end > data.len() {
            break;
        }
        let name = match msg_type {
            1 => "ClientHello",
            2 => "ServerHello",
            8 => "EncryptedExtensions",
            11 => "Certificate",
            13 => "CertificateRequest",
            15 => "CertificateVerify",
            20 => "Finished",
            4 => "NewSessionTicket",
            _ => "Handshake message",
        };
        let msg = &data[offset..end];
        segments.push(Segment {
            title: format!("TLS {name}"),
            hex: hex_of(msg),
            byte_len: msg.len(),
            truncated: msg.len() > MAX_SEGMENT_HEX_BYTES,
            fields: vec![
                Field::bytes(
                    "Handshake type",
                    format!("{name} ({msg_type})"),
                    "The TLS 1.3 handshake message type (byte 0 of the message).",
                    0,
                    1,
                ),
                Field::bytes(
                    "Length",
                    length.to_string(),
                    "The 24-bit length of the handshake message body (bytes 1-3).",
                    1,
                    3,
                ),
            ],
        });
        offset = end;
        if segments.len() >= MAX_SEGMENTS {
            break;
        }
    }
    segments
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hx(s: &str) -> Vec<u8> {
        let clean: String = s.chars().filter(|c| !c.is_whitespace()).collect();
        (0..clean.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&clean[i..i + 2], 16).expect("valid hex"))
            .collect()
    }

    // TC-011/TC-012 -> AC-009/AC-010: the RFC 9001 §A.2 client Initial packet parses to a
    // long-header Initial, decrypts with the version-salt initial keys, and its CRYPTO frame
    // reassembles a ClientHello. This is the offline, deterministic anchor for the whole decoder.
    #[test]
    fn should_parse_and_decrypt_the_rfc9001_client_initial_packet() {
        // The full protected A.2 packet (padded to 1200 bytes on the wire).
        let packet = rfc9001_a2_packet();
        let dcid = hx("8394c8f03e515708");

        let parsed = parse_datagram(&packet, Some(&dcid), &SecretSet::empty(), true, 0);
        assert_eq!(parsed.len(), 1, "one Initial packet in the datagram");
        let initial = &parsed[0];
        assert_eq!(initial.kind, PacketKind::Initial);
        assert_eq!(initial.version, Some(0x0000_0001));
        assert_eq!(initial.dcid, dcid);
        assert_eq!(initial.packet_number, Some(2), "A.2 packet number is 2");

        let plaintext = initial
            .plaintext
            .as_ref()
            .expect("A.2 Initial must decrypt with the salt-derived initial keys");

        // The decrypted frames start with a CRYPTO frame carrying a ClientHello (type 1).
        let mut crypto = Vec::new();
        collect_crypto(plaintext, &mut crypto);
        crypto.sort_by_key(|(off, _)| *off);
        let reassembled: Vec<u8> = crypto.into_iter().flat_map(|(_, d)| d).collect();
        assert_eq!(reassembled.first(), Some(&1u8), "first handshake msg is ClientHello");

        let segments = tls_handshake_segments(&reassembled);
        assert!(
            segments.iter().any(|s| s.title == "TLS ClientHello"),
            "the CRYPTO frame reassembles a ClientHello segment"
        );

        // AC-009: the QUIC transport segment locates the header fields at their true byte ranges.
        let segment = quic_packet_segment(initial, "sent");
        let version = segment
            .fields
            .iter()
            .find(|f| f.label == "Version")
            .expect("a Version field");
        assert_eq!(version.byte_offset, Some(1), "version is bytes 1-4");
        assert_eq!(version.byte_length, Some(4));
        let dcid = segment
            .fields
            .iter()
            .find(|f| f.label == "Destination Connection ID")
            .expect("a DCID field");
        assert_eq!(dcid.byte_offset, Some(6), "DCID starts at byte 6");
        assert_eq!(dcid.byte_length, Some(8), "A.2 DCID is 8 bytes");
        assert_eq!(dcid.value, "8394c8f03e515708");
        // The packet number is byte-located (not just a fact), 4 bytes for the A.2 packet.
        let pn = segment
            .fields
            .iter()
            .find(|f| f.label == "Packet number")
            .expect("a packet-number field");
        assert_eq!(pn.byte_length, Some(4), "A.2 uses a 4-byte packet number");
    }

    // AC-009: a long-header packet with a non-empty SCID exposes it as a byte-located field at the
    // offset right after the DCID (DCID-len byte + DCID + SCID-len byte).
    #[test]
    fn should_byte_locate_the_source_connection_id() {
        // Handshake long header: first byte 0xe0, version 1, DCID len 4 (aabbccdd), SCID len 2
        // (1122), then a token-less length varint 0x10 (16 bytes) + a 16-byte (undecryptable) body
        // that consumes the datagram exactly. We only need the header fields located.
        let bytes = hx("e000000001 04aabbccdd 021122 10 0102030405060708090a0b0c0d0e0f10");
        let parsed = parse_datagram(&bytes, None, &SecretSet::empty(), false, 0);
        assert_eq!(parsed.len(), 1);
        let segment = quic_packet_segment(&parsed[0], "received");
        let scid = segment
            .fields
            .iter()
            .find(|f| f.label == "Source Connection ID")
            .expect("a SCID field");
        // Offset = 1 (first) + 4 (version) + 1 (dcid len) + 4 (dcid) + 1 (scid len) = 11.
        assert_eq!(scid.byte_offset, Some(11), "SCID follows the DCID + its length byte");
        assert_eq!(scid.byte_length, Some(2));
        assert_eq!(scid.value, "1122");
    }

    // TC-015 -> AC-015: with an empty keylog, a 1-RTT (short-header) packet still yields a QUIC
    // transport segment with its header form decoded and the payload marked encrypted - the
    // dissection never panics or drops the packet just because keys are missing.
    #[test]
    fn should_mark_1rtt_encrypted_without_keys_and_not_panic() {
        // A minimal short-header packet: first byte 0x40 (short header, fixed bit) + some bytes.
        let short = hx("40aabbccddeeff00112233445566778899");
        let parsed = parse_datagram(&short, None, &SecretSet::empty(), false, 0);

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].kind, PacketKind::OneRtt);
        assert!(parsed[0].plaintext.is_none(), "no keys -> payload stays encrypted");

        let segment = quic_packet_segment(&parsed[0], "received");
        assert!(segment.fields.iter().any(|f| f.value == "encrypted (no key / not decryptable)"));
    }

    // AC-008: dissect_quic over a capture with a real Initial packet returns layered output
    // including Application(HTTP/3), TLS, QUIC transport, and UDP.
    #[test]
    fn should_return_layered_dissection_with_quic_and_udp_layers() {
        let capture = QuicCapture {
            peer_addr: Some("1.2.3.4:443".parse().unwrap()),
            local_addr: Some("10.0.0.2:50000".parse().unwrap()),
            quic_version: Some(1),
            alpn: Some("h3".to_string()),
            tls_cipher: None,
            datagrams_out: vec![rfc9001_a2_packet()],
            datagrams_in: Vec::new(),
            keylog: Vec::new(),
        };

        let dissection =
            dissect_quic(&capture, &PacketCapture::default()).expect("a capture yields a dissection");

        let names: Vec<&str> = dissection.layers.iter().map(|l| l.name.as_str()).collect();
        assert!(names.contains(&"Application (HTTP/3)"));
        assert!(names.iter().any(|n| n.contains("TLS 1.3 over QUIC")));
        assert!(names.contains(&"Transport (QUIC)"));
        assert!(names.contains(&"Transport (UDP)"));
    }

    // AC-015: no capture at all -> None (parallels the tap path).
    #[test]
    fn should_return_none_if_nothing_was_captured() {
        let empty = QuicCapture::default();
        assert!(dissect_quic(&empty, &PacketCapture::default()).is_none());
    }

    impl SecretSet {
        fn empty() -> Self {
            Self {
                client_handshake: None,
                server_handshake: None,
                client_app: None,
                server_app: None,
            }
        }
    }

    fn rfc9001_a2_packet() -> Vec<u8> {
        hx(concat!(
            "c000000001088394c8f03e5157080000449e7b9aec34d1b1c98dd7689fb8ec11",
            "d242b123dc9bd8bab936b47d92ec356c0bab7df5976d27cd449f63300099f399",
            "1c260ec4c60d17b31f8429157bb35a1282a643a8d2262cad67500cadb8e7378c",
            "8eb7539ec4d4905fed1bee1fc8aafba17c750e2c7ace01e6005f80fcb7df6212",
            "30c83711b39343fa028cea7f7fb5ff89eac2308249a02252155e2347b63d58c5",
            "457afd84d05dfffdb20392844ae812154682e9cf012f9021a6f0be17ddd0c208",
            "4dce25ff9b06cde535d0f920a2db1bf362c23e596d11a4f5a6cf3948838a3aec",
            "4e15daf8500a6ef69ec4e3feb6b1d98e610ac8b7ec3faf6ad760b7bad1db4ba3",
            "485e8a94dc250ae3fdb41ed15fb6a8e5eba0fc3dd60bc8e30c5c4287e53805db",
            "059ae0648db2f64264ed5e39be2e20d82df566da8dd5998ccabdae053060ae6c",
            "7b4378e846d29f37ed7b4ea9ec5d82e7961b7f25a9323851f681d582363aa5f8",
            "9937f5a67258bf63ad6f1a0b1d96dbd4faddfcefc5266ba6611722395c906556",
            "be52afe3f565636ad1b17d508b73d8743eeb524be22b3dcbc2c7468d54119c74",
            "68449a13d8e3b95811a198f3491de3e7fe942b330407abf82a4ed7c1b311663a",
            "c69890f4157015853d91e923037c227a33cdd5ec281ca3f79c44546b9d90ca00",
            "f064c99e3dd97911d39fe9c5d0b23a229a234cb36186c4819e8b9c5927726632",
            "291d6a418211cc2962e20fe47feb3edf330f2c603a9d48c0fcb5699dbfe58964",
            "25c5bac4aee82e57a85aaf4e2513e4f05796b07ba2ee47d80506f8d2c25e50fd",
            "14de71e6c418559302f939b0e1abd576f279c4b2e0feb85c1f28ff18f58891ff",
            "ef132eef2fa09346aee33c28eb130ff28f5b766953334113211996d20011a198",
            "e3fc433f9f2541010ae17c1bf202580f6047472fb36857fe843b19f5984009dd",
            "c324044e847a4f4a0ab34f719595de37252d6235365e9b84392b061085349d73",
            "203a4a13e96f5432ec0fd4a1ee65accdd5e3904df54c1da510b0ff20dcc0c77f",
            "cb2c0e0eb605cb0504db87632cf3d8b4dae6e705769d1de354270123cb11450e",
            "fc60ac47683d7b8d0f811365565fd98c4c8eb936bcab8d069fc33bd801b03ade",
            "a2e1fbc5aa463d08ca19896d2bf59a071b851e6c239052172f296bfb5e724047",
            "90a2181014f3b94a4e97d117b438130368cc39dbb2d198065ae3986547926cd2",
            "162f40a29f0c3c8745c0f50fba3852e566d44575c29d39a03f0cda721984b6f4",
            "40591f355e12d439ff150aab7613499dbd49adabc8676eef023b15b65bfc5ca0",
            "6948109f23f350db82123535eb8a7433bdabcb909271a6ecbcb58b936a88cd4e",
            "8f2e6ff5800175f113253d8fa9ca8885c2f552e657dc603f252e1a8e308f76f0",
            "be79e2fb8f5d5fbbe2e30ecadd220723c8c0aea8078cdfcb3868263ff8f09400",
            "54da48781893a7e49ad5aff4af300cd804a6b6279ab3ff3afb64491c85194aab",
            "760d58a606654f9f4400e8b38591356fbf6425aca26dc85244259ff2b19c41b9",
            "f96f3ca9ec1dde434da7d2d392b905ddf3d1f9af93d1af5950bd493f5aa731b4",
            "056df31bd267b6b90a079831aaf579be0a39013137aac6d404f518cfd4684064",
            "7e78bfe706ca4cf5e9c5453e9f7cfd2b8b4c8d169a44e55c88d4a9a7f9474241",
            "e221af44860018ab0856972e194cd934",
        ))
    }
}
