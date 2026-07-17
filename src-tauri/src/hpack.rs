// HPACK (RFC 7541) header-block decoder. Decodes the compressed header block carried by HTTP/2
// HEADERS/CONTINUATION/PUSH_PROMISE frames into plaintext `name: value` pairs, each byte-located at
// its on-wire representation so the dissection layer can highlight the exact bytes. Best-effort: a
// truncated or malformed block stops gracefully and never panics (the input is untrusted wire data).
#![cfg_attr(not(test), allow(dead_code))]

use std::collections::VecDeque;

// One decoded HPACK header field. `byte_offset`/`byte_len` locate the representation within the
// decoded header block so the dissection layer can rebase them onto the frame segment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedHeader {
    pub name: String,
    pub value: String,
    pub kind: HeaderRepr,
    pub byte_offset: usize,
    pub byte_len: usize,
}

// The plain-language kind of an HPACK representation (RFC 7541 s6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeaderRepr {
    Indexed,
    LiteralIndexed,
    LiteralNoIndex,
    LiteralNeverIndexed,
    SizeUpdate,
}

// Per-HPACK-entry overhead in octets when accounting dynamic-table size (RFC 7541 s4.1).
const ENTRY_OVERHEAD: usize = 32;
// Default dynamic-table max (SETTINGS_HEADER_TABLE_SIZE default, RFC 7540 s6.5.2).
const DEFAULT_MAX_TABLE_SIZE: usize = 4096;

// Per-direction HPACK dynamic table (RFC 7541 s2.3.2 / s4). Newest insertion is `entries.front()`
// and maps to the lowest dynamic index (62); eviction drops from the back.
#[derive(Debug, Clone)]
pub struct DynamicTable {
    entries: VecDeque<(String, String)>,
    max_size: usize,
    size: usize,
}

impl Default for DynamicTable {
    fn default() -> Self {
        Self::with_max(DEFAULT_MAX_TABLE_SIZE)
    }
}

impl DynamicTable {
    // Construct a dynamic table with the given maximum size in octets (SETTINGS_HEADER_TABLE_SIZE).
    pub fn with_max(max: usize) -> Self {
        Self {
            entries: VecDeque::new(),
            max_size: max,
            size: 0,
        }
    }

    fn insert(&mut self, name: String, value: String) {
        let entry_size = name.len() + value.len() + ENTRY_OVERHEAD;
        self.entries.push_front((name, value));
        self.size += entry_size;
        self.evict_to_fit();
    }

    fn set_max(&mut self, max: usize) {
        self.max_size = max;
        self.evict_to_fit();
    }

    fn evict_to_fit(&mut self) {
        while self.size > self.max_size {
            match self.entries.pop_back() {
                Some((name, value)) => {
                    self.size -= name.len() + value.len() + ENTRY_OVERHEAD;
                }
                None => {
                    self.size = 0;
                    break;
                }
            }
        }
    }

    // Dynamic-table index is relative: 0 = newest entry (HPACK index 62).
    fn get(&self, dynamic_index: usize) -> Option<&(String, String)> {
        self.entries.get(dynamic_index)
    }
}

// Decode one HPACK header-block fragment against `table`, returning one `DecodedHeader` per
// representation. Best-effort: a truncated/malformed block stops gracefully (never panics).
pub fn decode_block(block: &[u8], table: &mut DynamicTable) -> Vec<DecodedHeader> {
    let mut headers = Vec::new();
    let mut offset = 0usize;

    while offset < block.len() {
        let start = offset;
        let first = block[offset];

        let Some(header) = decode_representation(block, &mut offset, first, table) else {
            break;
        };
        // A representation that consumed no bytes would loop forever - guard against it.
        if offset <= start {
            break;
        }
        headers.push(DecodedHeader {
            byte_offset: start,
            byte_len: offset - start,
            ..header
        });
    }
    headers
}

// One representation, advancing `offset`. `header` fields carry placeholder byte range (0/0);
// `decode_block` rebases them. Returns None on any truncation/illegal state (stops the block).
struct PartialHeader {
    name: String,
    value: String,
    kind: HeaderRepr,
}

impl PartialHeader {
    fn into_decoded(self) -> DecodedHeader {
        DecodedHeader {
            name: self.name,
            value: self.value,
            kind: self.kind,
            byte_offset: 0,
            byte_len: 0,
        }
    }
}

fn decode_representation(
    block: &[u8],
    offset: &mut usize,
    first: u8,
    table: &mut DynamicTable,
) -> Option<DecodedHeader> {
    let partial = if first & 0x80 != 0 {
        decode_indexed(block, offset, table)?
    } else if first & 0x40 != 0 {
        decode_literal(block, offset, 6, HeaderRepr::LiteralIndexed, table)?
    } else if first & 0x20 != 0 {
        decode_size_update(block, offset, table)?
    } else {
        let kind = if first & 0x10 != 0 {
            HeaderRepr::LiteralNeverIndexed
        } else {
            HeaderRepr::LiteralNoIndex
        };
        decode_literal(block, offset, 4, kind, table)?
    };
    Some(partial.into_decoded())
}

// s6.1 - indexed header field: the whole name+value is at one table index.
fn decode_indexed(
    block: &[u8],
    offset: &mut usize,
    table: &DynamicTable,
) -> Option<PartialHeader> {
    let index = decode_integer(block, offset, 7)?;
    if index == 0 {
        return None;
    }
    let (name, value) = resolve_index(index, table)?;
    Some(PartialHeader {
        name,
        value,
        kind: HeaderRepr::Indexed,
    })
}

// s6.2.1/s6.2.2/s6.2.3 - literal header field. `prefix` = 6 (incremental indexing), 4 (without /
// never indexed). A zero index means the name is a literal string that follows.
fn decode_literal(
    block: &[u8],
    offset: &mut usize,
    prefix: u8,
    kind: HeaderRepr,
    table: &mut DynamicTable,
) -> Option<PartialHeader> {
    let index = decode_integer(block, offset, prefix)?;
    let name = if index == 0 {
        decode_string(block, offset)?
    } else {
        resolve_index(index, table)?.0
    };
    let value = decode_string(block, offset)?;
    if kind == HeaderRepr::LiteralIndexed {
        table.insert(name.clone(), value.clone());
    }
    Some(PartialHeader { name, value, kind })
}

// s6.3 - dynamic table size update: `001` prefix + a 5-bit-prefix integer new max size.
fn decode_size_update(
    block: &[u8],
    offset: &mut usize,
    table: &mut DynamicTable,
) -> Option<PartialHeader> {
    let max = decode_integer(block, offset, 5)?;
    table.set_max(max);
    Some(PartialHeader {
        name: String::new(),
        value: format!("max {max} octets"),
        kind: HeaderRepr::SizeUpdate,
    })
}

// Combined HPACK index -> (name, value). 1..=61 = static table; 62+ = dynamic table (newest first).
// Index 0 is illegal (RFC 7541 s6.1); reject it here so the no-panic contract holds regardless of
// which representation called in.
fn resolve_index(index: usize, table: &DynamicTable) -> Option<(String, String)> {
    if index == 0 {
        return None;
    }
    if index <= STATIC_TABLE.len() {
        let (name, value) = STATIC_TABLE[index - 1];
        return Some((name.to_string(), value.to_string()));
    }
    let dynamic_index = index - STATIC_TABLE.len() - 1;
    table
        .get(dynamic_index)
        .map(|(name, value)| (name.clone(), value.clone()))
}

// s5.1 - integer with an N-bit prefix. Returns the value and advances `offset` past all bytes it
// consumed. None if a continuation byte runs past the block or the shift would overflow.
fn decode_integer(block: &[u8], offset: &mut usize, prefix: u8) -> Option<usize> {
    let first = *block.get(*offset)?;
    *offset += 1;
    let mask = (1u16 << prefix) - 1;
    let mut value = (first as u16 & mask) as usize;
    if (value as u16) < mask {
        return Some(value);
    }
    let mut shift = 0u32;
    loop {
        let byte = *block.get(*offset)?;
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

// s5.2 - string literal: an H-flag + a 7-bit-prefix length, then that many octets (Huffman-coded
// when H is set, raw otherwise). None if the declared length runs past the block or decode fails.
fn decode_string(block: &[u8], offset: &mut usize) -> Option<String> {
    let first = *block.get(*offset)?;
    let is_huffman = first & 0x80 != 0;
    let length = decode_integer(block, offset, 7)?;
    let end = offset.checked_add(length)?;
    let raw = block.get(*offset..end)?;
    *offset = end;
    if is_huffman {
        return huffman_decode(raw);
    }
    String::from_utf8(raw.to_vec()).ok()
}

// QPACK (RFC 9204) uses the identical RFC 7541 Appendix-B Huffman code, so its decoder reuses this
// one rather than duplicating the 257-entry table.
pub fn huffman_decode_public(input: &[u8]) -> Option<String> {
    huffman_decode(input)
}

// Appendix B - canonical Huffman decode. Reads bits MSB-first, matching the prefix-free code table;
// leftover bits must be all-ones EOS padding (< 8 bits). None on an invalid code or embedded EOS.
fn huffman_decode(input: &[u8]) -> Option<String> {
    let mut out = Vec::new();
    let mut code: u32 = 0;
    let mut len: u8 = 0;
    for &byte in input {
        for shift in (0..8).rev() {
            code = (code << 1) | ((byte >> shift) & 1) as u32;
            len += 1;
            if len > 30 {
                return None;
            }
            if let Some(symbol) = huffman_lookup(len, code) {
                if symbol == 256 {
                    return None;
                }
                out.push(symbol as u8);
                code = 0;
                len = 0;
            }
        }
    }
    if len >= 8 {
        return None;
    }
    if len > 0 {
        let all_ones = (1u32 << len) - 1;
        if code != all_ones {
            return None;
        }
    }
    String::from_utf8(out).ok()
}

// Prefix-free lookup: the symbol whose code is exactly (len, code), if any.
fn huffman_lookup(len: u8, code: u32) -> Option<usize> {
    HUFFMAN_TABLE
        .iter()
        .position(|&(bits, value)| bits == len && value == code)
}

// RFC 7541 Appendix A static table (indices 1..=61): the fixed (name, value) pairs every HPACK
// endpoint shares. An empty value means the entry indexes the name only.
const STATIC_TABLE: [(&str, &str); 61] = [
    (":authority", ""),
    (":method", "GET"),
    (":method", "POST"),
    (":path", "/"),
    (":path", "/index.html"),
    (":scheme", "http"),
    (":scheme", "https"),
    (":status", "200"),
    (":status", "204"),
    (":status", "206"),
    (":status", "304"),
    (":status", "400"),
    (":status", "404"),
    (":status", "500"),
    ("accept-charset", ""),
    ("accept-encoding", "gzip, deflate"),
    ("accept-language", ""),
    ("accept-ranges", ""),
    ("accept", ""),
    ("access-control-allow-origin", ""),
    ("age", ""),
    ("allow", ""),
    ("authorization", ""),
    ("cache-control", ""),
    ("content-disposition", ""),
    ("content-encoding", ""),
    ("content-language", ""),
    ("content-length", ""),
    ("content-location", ""),
    ("content-range", ""),
    ("content-type", ""),
    ("cookie", ""),
    ("date", ""),
    ("etag", ""),
    ("expect", ""),
    ("expires", ""),
    ("from", ""),
    ("host", ""),
    ("if-match", ""),
    ("if-modified-since", ""),
    ("if-none-match", ""),
    ("if-range", ""),
    ("if-unmodified-since", ""),
    ("last-modified", ""),
    ("link", ""),
    ("location", ""),
    ("max-forwards", ""),
    ("proxy-authenticate", ""),
    ("proxy-authorization", ""),
    ("range", ""),
    ("referer", ""),
    ("refresh", ""),
    ("retry-after", ""),
    ("server", ""),
    ("set-cookie", ""),
    ("strict-transport-security", ""),
    ("transfer-encoding", ""),
    ("user-agent", ""),
    ("vary", ""),
    ("via", ""),
    ("www-authenticate", ""),
];

// RFC 7541 Appendix B canonical Huffman code table: (code bit-length, code value) for each of
// the 256 symbols plus the EOS entry (index 256). Transcribed verbatim from the generated table
// in the vendored `h2` crate (h2-0.4.15/src/hpack/huffman/table.rs) to avoid hand-transcription error.
const HUFFMAN_TABLE: [(u8, u32); 257] = [
    (13, 0x1ff8),
    (23, 0x007fffd8),
    (28, 0x0fffffe2),
    (28, 0x0fffffe3),
    (28, 0x0fffffe4),
    (28, 0x0fffffe5),
    (28, 0x0fffffe6),
    (28, 0x0fffffe7),
    (28, 0x0fffffe8),
    (24, 0x00ffffea),
    (30, 0x3ffffffc),
    (28, 0x0fffffe9),
    (28, 0x0fffffea),
    (30, 0x3ffffffd),
    (28, 0x0fffffeb),
    (28, 0x0fffffec),
    (28, 0x0fffffed),
    (28, 0x0fffffee),
    (28, 0x0fffffef),
    (28, 0x0ffffff0),
    (28, 0x0ffffff1),
    (28, 0x0ffffff2),
    (30, 0x3ffffffe),
    (28, 0x0ffffff3),
    (28, 0x0ffffff4),
    (28, 0x0ffffff5),
    (28, 0x0ffffff6),
    (28, 0x0ffffff7),
    (28, 0x0ffffff8),
    (28, 0x0ffffff9),
    (28, 0x0ffffffa),
    (28, 0x0ffffffb),
    (6, 0x14),
    (10, 0x3f8),
    (10, 0x3f9),
    (12, 0xffa),
    (13, 0x1ff9),
    (6, 0x15),
    (8, 0xf8),
    (11, 0x7fa),
    (10, 0x3fa),
    (10, 0x3fb),
    (8, 0xf9),
    (11, 0x7fb),
    (8, 0xfa),
    (6, 0x16),
    (6, 0x17),
    (6, 0x18),
    (5, 0x0),
    (5, 0x1),
    (5, 0x2),
    (6, 0x19),
    (6, 0x1a),
    (6, 0x1b),
    (6, 0x1c),
    (6, 0x1d),
    (6, 0x1e),
    (6, 0x1f),
    (7, 0x5c),
    (8, 0xfb),
    (15, 0x7ffc),
    (6, 0x20),
    (12, 0xffb),
    (10, 0x3fc),
    (13, 0x1ffa),
    (6, 0x21),
    (7, 0x5d),
    (7, 0x5e),
    (7, 0x5f),
    (7, 0x60),
    (7, 0x61),
    (7, 0x62),
    (7, 0x63),
    (7, 0x64),
    (7, 0x65),
    (7, 0x66),
    (7, 0x67),
    (7, 0x68),
    (7, 0x69),
    (7, 0x6a),
    (7, 0x6b),
    (7, 0x6c),
    (7, 0x6d),
    (7, 0x6e),
    (7, 0x6f),
    (7, 0x70),
    (7, 0x71),
    (7, 0x72),
    (8, 0xfc),
    (7, 0x73),
    (8, 0xfd),
    (13, 0x1ffb),
    (19, 0x7fff0),
    (13, 0x1ffc),
    (14, 0x3ffc),
    (6, 0x22),
    (15, 0x7ffd),
    (5, 0x3),
    (6, 0x23),
    (5, 0x4),
    (6, 0x24),
    (5, 0x5),
    (6, 0x25),
    (6, 0x26),
    (6, 0x27),
    (5, 0x6),
    (7, 0x74),
    (7, 0x75),
    (6, 0x28),
    (6, 0x29),
    (6, 0x2a),
    (5, 0x7),
    (6, 0x2b),
    (7, 0x76),
    (6, 0x2c),
    (5, 0x8),
    (5, 0x9),
    (6, 0x2d),
    (7, 0x77),
    (7, 0x78),
    (7, 0x79),
    (7, 0x7a),
    (7, 0x7b),
    (15, 0x7ffe),
    (11, 0x7fc),
    (14, 0x3ffd),
    (13, 0x1ffd),
    (28, 0x0ffffffc),
    (20, 0xfffe6),
    (22, 0x003fffd2),
    (20, 0xfffe7),
    (20, 0xfffe8),
    (22, 0x003fffd3),
    (22, 0x003fffd4),
    (22, 0x003fffd5),
    (23, 0x007fffd9),
    (22, 0x003fffd6),
    (23, 0x007fffda),
    (23, 0x007fffdb),
    (23, 0x007fffdc),
    (23, 0x007fffdd),
    (23, 0x007fffde),
    (24, 0x00ffffeb),
    (23, 0x007fffdf),
    (24, 0x00ffffec),
    (24, 0x00ffffed),
    (22, 0x003fffd7),
    (23, 0x007fffe0),
    (24, 0x00ffffee),
    (23, 0x007fffe1),
    (23, 0x007fffe2),
    (23, 0x007fffe3),
    (23, 0x007fffe4),
    (21, 0x001fffdc),
    (22, 0x003fffd8),
    (23, 0x007fffe5),
    (22, 0x003fffd9),
    (23, 0x007fffe6),
    (23, 0x007fffe7),
    (24, 0x00ffffef),
    (22, 0x003fffda),
    (21, 0x001fffdd),
    (20, 0xfffe9),
    (22, 0x003fffdb),
    (22, 0x003fffdc),
    (23, 0x007fffe8),
    (23, 0x007fffe9),
    (21, 0x001fffde),
    (23, 0x007fffea),
    (22, 0x003fffdd),
    (22, 0x003fffde),
    (24, 0x00fffff0),
    (21, 0x001fffdf),
    (22, 0x003fffdf),
    (23, 0x007fffeb),
    (23, 0x007fffec),
    (21, 0x001fffe0),
    (21, 0x001fffe1),
    (22, 0x003fffe0),
    (21, 0x001fffe2),
    (23, 0x007fffed),
    (22, 0x003fffe1),
    (23, 0x007fffee),
    (23, 0x007fffef),
    (20, 0xfffea),
    (22, 0x003fffe2),
    (22, 0x003fffe3),
    (22, 0x003fffe4),
    (23, 0x007ffff0),
    (22, 0x003fffe5),
    (22, 0x003fffe6),
    (23, 0x007ffff1),
    (26, 0x03ffffe0),
    (26, 0x03ffffe1),
    (20, 0xfffeb),
    (19, 0x7fff1),
    (22, 0x003fffe7),
    (23, 0x007ffff2),
    (22, 0x003fffe8),
    (25, 0x01ffffec),
    (26, 0x03ffffe2),
    (26, 0x03ffffe3),
    (26, 0x03ffffe4),
    (27, 0x07ffffde),
    (27, 0x07ffffdf),
    (26, 0x03ffffe5),
    (24, 0x00fffff1),
    (25, 0x01ffffed),
    (19, 0x7fff2),
    (21, 0x001fffe3),
    (26, 0x03ffffe6),
    (27, 0x07ffffe0),
    (27, 0x07ffffe1),
    (26, 0x03ffffe7),
    (27, 0x07ffffe2),
    (24, 0x00fffff2),
    (21, 0x001fffe4),
    (21, 0x001fffe5),
    (26, 0x03ffffe8),
    (26, 0x03ffffe9),
    (28, 0x0ffffffd),
    (27, 0x07ffffe3),
    (27, 0x07ffffe4),
    (27, 0x07ffffe5),
    (20, 0xfffec),
    (24, 0x00fffff3),
    (20, 0xfffed),
    (21, 0x001fffe6),
    (22, 0x003fffe9),
    (21, 0x001fffe7),
    (21, 0x001fffe8),
    (23, 0x007ffff3),
    (22, 0x003fffea),
    (22, 0x003fffeb),
    (25, 0x01ffffee),
    (25, 0x01ffffef),
    (24, 0x00fffff4),
    (24, 0x00fffff5),
    (26, 0x03ffffea),
    (23, 0x007ffff4),
    (26, 0x03ffffeb),
    (27, 0x07ffffe6),
    (26, 0x03ffffec),
    (26, 0x03ffffed),
    (27, 0x07ffffe7),
    (27, 0x07ffffe8),
    (27, 0x07ffffe9),
    (27, 0x07ffffea),
    (27, 0x07ffffeb),
    (28, 0x0ffffffe),
    (27, 0x07ffffec),
    (27, 0x07ffffed),
    (27, 0x07ffffee),
    (27, 0x07ffffef),
    (27, 0x07fffff0),
    (26, 0x03ffffee),
    (30, 0x3fffffff),
];

#[cfg(test)]
mod tests {
    use super::*;

    // AC-001 / AC-008 - behavior: an indexed static-table field decodes to name+value and is
    // byte-located at its single representation byte. Vector: RFC 7541 C.2.4 `82` = `:method: GET`.
    #[test]
    fn should_decode_an_indexed_static_field_if_the_high_bit_is_set() {
        let mut table = DynamicTable::default();
        let headers = decode_block(&[0x82], &mut table);

        assert_eq!(headers.len(), 1);
        let header = &headers[0];
        assert_eq!(header.name, ":method");
        assert_eq!(header.value, "GET");
        assert_eq!(header.kind, HeaderRepr::Indexed);
        assert_eq!(header.byte_offset, 0);
        assert_eq!(header.byte_len, 1);
    }

    // AC-002 - behavior: a literal-with-incremental-indexing field whose value is Huffman-coded
    // decodes to plaintext. Vector: RFC 7541 C.4.1 `:authority: www.example.com`
    // (`41` = literal-inc-index index 1; `8c` = H flag + length 12; then 12 Huffman bytes).
    #[test]
    fn should_decode_a_huffman_coded_literal_to_plaintext_if_the_h_flag_is_set() {
        let mut table = DynamicTable::default();
        let block = [
            0x41, 0x8c, 0xf1, 0xe3, 0xc2, 0xe5, 0xf2, 0x3a, 0x6b, 0xa0, 0xab, 0x90, 0xf4, 0xff,
        ];

        let headers = decode_block(&block, &mut table);

        assert_eq!(headers.len(), 1);
        assert_eq!(headers[0].name, ":authority");
        assert_eq!(headers[0].value, "www.example.com");
        assert_eq!(headers[0].kind, HeaderRepr::LiteralIndexed);
    }

    // AC-003 - behavior: a literal field with raw (non-Huffman) name and value strings decodes
    // correctly. Vector: RFC 7541 C.2.1 `custom-key: custom-header`
    // (`40` = literal-inc-index new name; `0a` len 10 name; `0d` len 13 value; all H-flag clear).
    #[test]
    fn should_decode_a_raw_literal_field_if_the_h_flag_is_clear() {
        let mut table = DynamicTable::default();
        let block = [
            0x40, 0x0a, 0x63, 0x75, 0x73, 0x74, 0x6f, 0x6d, 0x2d, 0x6b, 0x65, 0x79, 0x0d, 0x63,
            0x75, 0x73, 0x74, 0x6f, 0x6d, 0x2d, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72,
        ];

        let headers = decode_block(&block, &mut table);

        assert_eq!(headers.len(), 1);
        assert_eq!(headers[0].name, "custom-key");
        assert_eq!(headers[0].value, "custom-header");
        assert_eq!(headers[0].kind, HeaderRepr::LiteralIndexed);
    }

    // AC-004 - behavior: an HPACK integer that overflows its prefix is decoded across the
    // continuation bytes. Vector: RFC 7541 dynamic table size update to 4096 = `3f e1 1f` (5-bit
    // prefix `3f` overflows; `e1 1f` continue). The 3-byte `byte_len` proves the multi-byte decode.
    #[test]
    fn should_decode_a_multi_byte_hpack_integer_if_the_value_overflows_the_prefix() {
        let mut table = DynamicTable::with_max(4096);

        let headers = decode_block(&[0x3f, 0xe1, 0x1f], &mut table);

        assert_eq!(headers.len(), 1);
        // The whole 3-byte continued integer is one representation.
        assert_eq!(headers[0].byte_offset, 0);
        assert_eq!(headers[0].byte_len, 3);
        assert_eq!(headers[0].kind, HeaderRepr::SizeUpdate);
        // The decoded value is the continued integer 4096.
        assert!(
            headers[0].value.contains("4096"),
            "expected the decoded size-update value to carry 4096, got {:?}",
            headers[0].value
        );
    }

    // AC-005 - behavior: a literal-with-incremental-indexing field is inserted into the dynamic
    // table, so a later indexed reference (index 62) in the SAME table instance resolves to it.
    // Vector: RFC 7541 C.2.1 insert, then `be` (0x80 | 62).
    #[test]
    fn should_resolve_a_later_indexed_reference_if_a_literal_was_inserted_into_the_dynamic_table() {
        let mut table = DynamicTable::default();
        let insert = [
            0x40, 0x0a, 0x63, 0x75, 0x73, 0x74, 0x6f, 0x6d, 0x2d, 0x6b, 0x65, 0x79, 0x0d, 0x63,
            0x75, 0x73, 0x74, 0x6f, 0x6d, 0x2d, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72,
        ];

        let inserted = decode_block(&insert, &mut table);
        assert_eq!(inserted[0].name, "custom-key");

        // Same table instance: dynamic index 62 now resolves to the just-inserted entry.
        let referenced = decode_block(&[0xbe], &mut table);

        assert_eq!(referenced.len(), 1);
        assert_eq!(referenced[0].name, "custom-key");
        assert_eq!(referenced[0].value, "custom-header");
        assert_eq!(referenced[0].kind, HeaderRepr::Indexed);
    }

    // AC-006 - behavior: a dynamic table size update is decoded as its own byte-located field.
    // Vector: `20` = size update to 0 (`001` prefix + 5-bit value 0).
    #[test]
    fn should_decode_a_dynamic_table_size_update_as_its_own_field() {
        let mut table = DynamicTable::with_max(4096);

        let headers = decode_block(&[0x20], &mut table);

        assert_eq!(headers.len(), 1);
        assert_eq!(headers[0].kind, HeaderRepr::SizeUpdate);
        assert_eq!(headers[0].byte_offset, 0);
        assert_eq!(headers[0].byte_len, 1);
    }

    // AC-006 - behavior: a size update that shrinks the table evicts entries no longer fitting, so
    // an index into an evicted entry does not resolve. Insert custom-key (index 62), size update to
    // 0 (evicts it), then reference index 62 - it must not fabricate the evicted entry.
    #[test]
    fn should_evict_dynamic_entries_if_a_size_update_shrinks_the_table_below_them() {
        let mut table = DynamicTable::with_max(4096);
        let insert = [
            0x40, 0x0a, 0x63, 0x75, 0x73, 0x74, 0x6f, 0x6d, 0x2d, 0x6b, 0x65, 0x79, 0x0d, 0x63,
            0x75, 0x73, 0x74, 0x6f, 0x6d, 0x2d, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72,
        ];
        decode_block(&insert, &mut table);

        // Size update to 0 empties the dynamic table.
        decode_block(&[0x20], &mut table);

        // Index 62 no longer maps to a dynamic entry; the decoder must not resolve custom-key.
        let after = decode_block(&[0xbe], &mut table);
        let resolved_evicted = after.iter().any(|header| header.name == "custom-key");
        assert!(
            !resolved_evicted,
            "an evicted dynamic entry must not resolve after a size update to 0"
        );
    }

    // AC-009 - behavior: an indexed field with index 0 is illegal (RFC 7541 s6.1); it must stop the
    // block without panicking and without fabricating a header, not underflow the static table.
    #[test]
    fn should_stop_without_panic_if_an_indexed_field_uses_the_illegal_index_zero() {
        let mut table = DynamicTable::default();

        let headers = decode_block(&[0x80], &mut table);

        assert!(headers.is_empty());
    }

    // AC-009 - behavior: a block cut mid-representation must not panic and must not fabricate a
    // full value from missing bytes. `41 8c f1` claims a 12-byte Huffman value but supplies only 1.
    #[test]
    fn should_not_panic_and_return_partial_if_the_block_is_truncated_mid_representation() {
        let mut table = DynamicTable::default();

        let headers = decode_block(&[0x41, 0x8c, 0xf1], &mut table);

        let has_full_value = headers
            .iter()
            .any(|header| header.name == ":authority" && header.value == "www.example.com");
        assert!(
            !has_full_value,
            "a truncated block must not yield the full value from missing bytes"
        );
    }
}
