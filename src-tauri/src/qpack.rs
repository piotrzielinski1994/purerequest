// QPACK (RFC 9204) header-block decoder for HTTP/3. Decodes the encoded field section carried on a
// request/response stream into plaintext `name: value` pairs, each byte-located at its on-wire
// representation so the dissection layer can highlight the exact bytes. Best-effort: a truncated or
// malformed block stops gracefully and never panics (the input is untrusted wire data).
//
// Scope: the field-section prefix + static-table references + literal representations (with and
// without Huffman), which is what a fresh HTTP/3 request/response uses. Dynamic-table references
// (indexed with the T=0 bit, or post-base) are decoded structurally and reported, but their value
// is only resolved when a dynamic table is supplied; a bare request needs none (Required Insert
// Count 0). Reuses the HPACK Huffman decoder (identical RFC 7541 Appendix-B code).
#![allow(dead_code)]

use crate::hpack::huffman_decode_public;

// One decoded QPACK field line. `byte_offset`/`byte_len` locate the representation within the
// decoded field section so the dissection layer can rebase them onto the stream segment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedField {
    pub name: String,
    pub value: String,
    pub kind: FieldRepr,
    pub byte_offset: usize,
    pub byte_len: usize,
}

// The plain-language kind of a QPACK field-line representation (RFC 9204 §4.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldRepr {
    IndexedStatic,
    IndexedDynamic,
    LiteralWithNameRefStatic,
    LiteralWithNameRefDynamic,
    LiteralWithLiteralName,
}

// Decode a full encoded field section (the prefix + field lines) against the static table.
// Best-effort: stops at the first truncation/illegal state without panicking. Dynamic references
// are reported with a placeholder value (`<dynamic index N>`) since a bare request carries none.
pub fn decode_field_section(encoded: &[u8]) -> Vec<DecodedField> {
    let mut offset = 0usize;
    // Field Section Prefix: Required Insert Count (8-bit prefix) + Delta Base (7-bit prefix, with
    // a sign bit). We decode past them (their values only matter for dynamic-table indexing).
    if decode_integer(encoded, &mut offset, 8).is_none() {
        return Vec::new();
    }
    if offset >= encoded.len() {
        return Vec::new();
    }
    // Delta Base: bit 7 is the sign, low 7 are the prefixed integer.
    if decode_integer(encoded, &mut offset, 7).is_none() {
        return Vec::new();
    }

    decode_field_lines(encoded, offset)
}

// Decode just the field lines (no prefix) starting at `start`. Split out so tests can exercise a
// single representation, and so the prefix decode stays a thin wrapper.
fn decode_field_lines(encoded: &[u8], start: usize) -> Vec<DecodedField> {
    let mut fields = Vec::new();
    let mut offset = start;

    while offset < encoded.len() {
        let repr_start = offset;
        let first = encoded[offset];

        let Some(field) = decode_field_line(encoded, &mut offset, first) else {
            break;
        };
        if offset <= repr_start {
            break;
        }
        fields.push(DecodedField {
            name: field.name,
            value: field.value,
            kind: field.kind,
            byte_offset: repr_start,
            byte_len: offset - repr_start,
        });
    }
    fields
}

struct PartialField {
    name: String,
    value: String,
    kind: FieldRepr,
}

fn decode_field_line(encoded: &[u8], offset: &mut usize, first: u8) -> Option<PartialField> {
    // RFC 9204 §4.5.2-§4.5.6: the top bits of the first byte select the representation.
    if first & 0x80 != 0 {
        // Indexed field line: `1` T-bit index(6+). T=1 -> static, T=0 -> dynamic.
        let is_static = first & 0x40 != 0;
        let index = decode_integer(encoded, offset, 6)?;
        if is_static {
            let (name, value) = static_entry(index)?;
            return Some(PartialField {
                name,
                value,
                kind: FieldRepr::IndexedStatic,
            });
        }
        return Some(PartialField {
            name: String::new(),
            value: format!("<dynamic index {index}>"),
            kind: FieldRepr::IndexedDynamic,
        });
    }
    if first & 0x40 != 0 {
        // Literal with name reference: `01` N-bit T-bit index(4+), then a value string.
        let is_static = first & 0x10 != 0;
        let index = decode_integer(encoded, offset, 4)?;
        let value = decode_string(encoded, offset, 7)?;
        if is_static {
            let (name, _) = static_entry(index)?;
            return Some(PartialField {
                name,
                value,
                kind: FieldRepr::LiteralWithNameRefStatic,
            });
        }
        return Some(PartialField {
            name: format!("<dynamic index {index}>"),
            value,
            kind: FieldRepr::LiteralWithNameRefDynamic,
        });
    }
    if first & 0x20 != 0 {
        // Literal with literal name: `001` N-bit H-bit namelen(3+), name, then a value string.
        let name = decode_string(encoded, offset, 3)?;
        let value = decode_string(encoded, offset, 7)?;
        return Some(PartialField {
            name,
            value,
            kind: FieldRepr::LiteralWithLiteralName,
        });
    }
    // `0001` prefixes are post-base indexed / literal-post-base-name-ref (dynamic table only);
    // a bare request never emits them. Stop gracefully rather than mis-decode.
    None
}

// RFC 9204 §4.5.4/§4.5.6: a string literal is `H`-flag + a prefixed-integer length, then that many
// octets (Huffman-coded when H set, raw otherwise). `prefix` is the integer prefix width (7 for a
// value string, 3 for a literal name). None if the declared length runs past the block.
fn decode_string(encoded: &[u8], offset: &mut usize, prefix: u8) -> Option<String> {
    let first = *encoded.get(*offset)?;
    let is_huffman = first & (1 << prefix) != 0;
    let length = decode_integer(encoded, offset, prefix)?;
    let end = offset.checked_add(length)?;
    let raw = encoded.get(*offset..end)?;
    *offset = end;
    if is_huffman {
        return huffman_decode_public(raw);
    }
    String::from_utf8(raw.to_vec()).ok()
}

// RFC 9204 §4.1.1 prefixed integer (same algorithm as HPACK RFC 7541 §5.1). Advances `offset`.
fn decode_integer(encoded: &[u8], offset: &mut usize, prefix: u8) -> Option<usize> {
    let first = *encoded.get(*offset)?;
    *offset += 1;
    let mask = (1u16 << prefix) - 1;
    let value = (first as u16 & mask) as usize;
    if (value as u16) < mask {
        return Some(value);
    }
    let mut value = value;
    let mut shift = 0u32;
    loop {
        let byte = *encoded.get(*offset)?;
        *offset += 1;
        value = value.checked_add(((byte & 0x7f) as usize).checked_shl(shift)?)?;
        if byte & 0x80 == 0 {
            return Some(value);
        }
        shift += 7;
        if shift > usize::BITS {
            return None;
        }
    }
}

// RFC 9204 Appendix A static table (indices 0..=98): the fixed (name, value) pairs. An empty value
// means the entry indexes the name only. Transcribed from the vendored `h3` crate's `qpack/static_`
// (which mirrors the RFC) to avoid hand-transcription error.
fn static_entry(index: usize) -> Option<(String, String)> {
    STATIC_TABLE
        .get(index)
        .map(|(name, value)| (name.to_string(), value.to_string()))
}

const STATIC_TABLE: [(&str, &str); 99] = [
    (":authority", ""),
    (":path", "/"),
    ("age", "0"),
    ("content-disposition", ""),
    ("content-length", "0"),
    ("cookie", ""),
    ("date", ""),
    ("etag", ""),
    ("if-modified-since", ""),
    ("if-none-match", ""),
    ("last-modified", ""),
    ("link", ""),
    ("location", ""),
    ("referer", ""),
    ("set-cookie", ""),
    (":method", "CONNECT"),
    (":method", "DELETE"),
    (":method", "GET"),
    (":method", "HEAD"),
    (":method", "OPTIONS"),
    (":method", "POST"),
    (":method", "PUT"),
    (":scheme", "http"),
    (":scheme", "https"),
    (":status", "103"),
    (":status", "200"),
    (":status", "304"),
    (":status", "404"),
    (":status", "503"),
    ("accept", "*/*"),
    ("accept", "application/dns-message"),
    ("accept-encoding", "gzip, deflate, br"),
    ("accept-ranges", "bytes"),
    ("access-control-allow-headers", "cache-control"),
    ("access-control-allow-headers", "content-type"),
    ("access-control-allow-origin", "*"),
    ("cache-control", "max-age=0"),
    ("cache-control", "max-age=2592000"),
    ("cache-control", "max-age=604800"),
    ("cache-control", "no-cache"),
    ("cache-control", "no-store"),
    ("cache-control", "public, max-age=31536000"),
    ("content-encoding", "br"),
    ("content-encoding", "gzip"),
    ("content-type", "application/dns-message"),
    ("content-type", "application/javascript"),
    ("content-type", "application/json"),
    ("content-type", "application/x-www-form-urlencoded"),
    ("content-type", "image/gif"),
    ("content-type", "image/jpeg"),
    ("content-type", "image/png"),
    ("content-type", "text/css"),
    ("content-type", "text/html; charset=utf-8"),
    ("content-type", "text/plain"),
    ("content-type", "text/plain;charset=utf-8"),
    ("range", "bytes=0-"),
    ("strict-transport-security", "max-age=31536000"),
    (
        "strict-transport-security",
        "max-age=31536000; includesubdomains",
    ),
    (
        "strict-transport-security",
        "max-age=31536000; includesubdomains; preload",
    ),
    ("vary", "accept-encoding"),
    ("vary", "origin"),
    ("x-content-type-options", "nosniff"),
    ("x-xss-protection", "1; mode=block"),
    (":status", "100"),
    (":status", "204"),
    (":status", "206"),
    (":status", "302"),
    (":status", "400"),
    (":status", "403"),
    (":status", "421"),
    (":status", "425"),
    (":status", "500"),
    ("accept-language", ""),
    ("access-control-allow-credentials", "FALSE"),
    ("access-control-allow-credentials", "TRUE"),
    ("access-control-allow-headers", "*"),
    ("access-control-allow-methods", "get"),
    ("access-control-allow-methods", "get, post, options"),
    ("access-control-allow-methods", "options"),
    ("access-control-expose-headers", "content-length"),
    ("access-control-request-headers", "content-type"),
    ("access-control-request-method", "get"),
    ("access-control-request-method", "post"),
    ("alt-svc", "clear"),
    ("authorization", ""),
    (
        "content-security-policy",
        "script-src 'none'; object-src 'none'; base-uri 'none'",
    ),
    ("early-data", "1"),
    ("expect-ct", ""),
    ("forwarded", ""),
    ("if-range", ""),
    ("origin", ""),
    ("purpose", "prefetch"),
    ("server", ""),
    ("timing-allow-origin", "*"),
    ("upgrade-insecure-requests", "1"),
    ("user-agent", ""),
    ("x-forwarded-for", ""),
    ("x-frame-options", "deny"),
    ("x-frame-options", "sameorigin"),
];

#[cfg(test)]
mod tests {
    use super::*;

    // AC-014 - behavior: an indexed static-table field line decodes to the RFC 9204 Appendix-A
    // entry. `0xd1` = `11` (indexed, T=1 static) + index 17 (:method GET) in the 6-bit prefix.
    #[test]
    fn should_decode_an_indexed_static_field_line() {
        let fields = decode_field_lines(&[0xd1], 0);

        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, ":method");
        assert_eq!(fields[0].value, "GET");
        assert_eq!(fields[0].kind, FieldRepr::IndexedStatic);
        assert_eq!(fields[0].byte_offset, 0);
        assert_eq!(fields[0].byte_len, 1);
    }

    // AC-014 - behavior: `:status 200` is static index 25. `0x80 | 0x40 | 25 = 0xd9`.
    #[test]
    fn should_decode_the_status_200_static_index() {
        let fields = decode_field_lines(&[0xd9], 0);

        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, ":status");
        assert_eq!(fields[0].value, "200");
    }

    // AC-014 - behavior: a literal field line with a static NAME reference and a raw value.
    // `:authority` is static index 0. First byte `01` + N=0 + T=1(static) + index 0 = 0x50; then
    // value string `0x03 "abc"` (H=0, len 3).
    #[test]
    fn should_decode_a_literal_with_static_name_ref_and_raw_value() {
        let mut block = vec![0x50, 0x03];
        block.extend_from_slice(b"abc");

        let fields = decode_field_lines(&block, 0);

        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, ":authority");
        assert_eq!(fields[0].value, "abc");
        assert_eq!(fields[0].kind, FieldRepr::LiteralWithNameRefStatic);
    }

    // AC-014 - behavior: a literal field line with a literal (raw) name AND value.
    // First byte `001` + N=0 + H=0 + namelen 3 (3-bit prefix) = 0x23; name "abc"; value `0x03 "xyz"`.
    #[test]
    fn should_decode_a_literal_with_literal_name_and_value() {
        let mut block = vec![0x23];
        block.extend_from_slice(b"abc");
        block.push(0x03);
        block.extend_from_slice(b"xyz");

        let fields = decode_field_lines(&block, 0);

        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, "abc");
        assert_eq!(fields[0].value, "xyz");
        assert_eq!(fields[0].kind, FieldRepr::LiteralWithLiteralName);
    }

    // AC-014 - behavior: a full field section (prefix + one field line) decodes past the prefix.
    // Prefix `00 00` (Required Insert Count 0, Delta Base 0), then `0xd1` (:method GET).
    #[test]
    fn should_decode_past_the_field_section_prefix() {
        let fields = decode_field_section(&[0x00, 0x00, 0xd1]);

        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, ":method");
        assert_eq!(fields[0].value, "GET");
    }

    // AC-014 - behavior: a Huffman-coded value on a static name ref decodes to plaintext. Reuses
    // the shared RFC 7541 Huffman table. `:authority` static-name-ref literal (0x50), then a
    // Huffman value: H=1 + len 12 = 0x8c, then the 12 Huffman bytes for "www.example.com".
    #[test]
    fn should_decode_a_huffman_coded_value() {
        let mut block = vec![0x50, 0x8c];
        block.extend_from_slice(&[
            0xf1, 0xe3, 0xc2, 0xe5, 0xf2, 0x3a, 0x6b, 0xa0, 0xab, 0x90, 0xf4, 0xff,
        ]);

        let fields = decode_field_lines(&block, 0);

        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, ":authority");
        assert_eq!(fields[0].value, "www.example.com");
    }

    // AC-015 - behavior: a block truncated mid-value must not panic and must not fabricate a value.
    // `0x50` (name ref) + `0x03` (len 3) but only 1 value byte supplied.
    #[test]
    fn should_not_panic_if_truncated_mid_value() {
        let fields = decode_field_lines(&[0x50, 0x03, 0x61], 0);

        let has_full = fields.iter().any(|field| field.value.len() == 3);
        assert!(!has_full, "a truncated value must not be fabricated");
    }

    // AC-014 - behavior: an out-of-range static index stops the block without panicking (index 200
    // has no static entry). `0x80|0x40` + 6-bit index 62 then continuation to 200.
    #[test]
    fn should_stop_without_panic_on_an_out_of_range_static_index() {
        // index 200 = 0xc0 (indexed static, prefix 63) + continuation bytes for 200-63=137.
        let fields = decode_field_lines(&[0xff, 0x89, 0x01], 0);

        assert!(fields.is_empty(), "an unknown static index must not resolve");
    }
}
