# Spec: h2-hpack-decode (protocol-stack-dissection - closes AC-E03)

Finishes the one deferred piece of the `protocol-stack-dissection` epic (item #7, merged as
`20260710134444-protocol-stack-dissection`). That epic decoded HTTP/2 frame *headers* to the bit
but left the compressed HEADERS/CONTINUATION/PUSH_PROMISE payload shown as a byte length only.
Epic AC-E03 requires "HTTP/2 frames + **HPACK-decompressed headers**" - this feature delivers the
HPACK decode.

## 1. Overview

Add an HPACK (RFC 7541) decoder over the header-block fragment carried by HTTP/2 HEADERS,
CONTINUATION and PUSH_PROMISE frames, wired into the existing `dissect.rs` HTTP/2 frame decoder.
Each decoded header becomes a byte-located `Field` child under the frame segment, so the Protocols
tab's hex view lights the exact representation bytes for a header line - same contract as every
other decoded field.

### Scope

In:
- New Rust module `hpack` with a pure `decode_block(block, &mut DynamicTable) -> Vec<DecodedHeader>`.
- HPACK representations (RFC 7541 s6): indexed header field, literal with incremental indexing,
  literal without indexing, literal never indexed, dynamic table size update.
- HPACK integer decode (s5.1, N-bit prefix + 7-bit continuation) and string literal decode (s5.2,
  H-flag + length + optional Huffman decode).
- The RFC 7541 static table (61 entries, Appendix A) and a per-direction dynamic table with
  eviction (entry size = name.len + value.len + 32, s4.1) driven by size updates.
- Canonical Huffman decode (Appendix B) from the RFC code table.
- HEADERS-frame PADDED (pad-length byte + trailing padding) and PRIORITY (5-byte dependency+weight)
  prefixes skipped so the header block starts at the right offset.
- Wire into `decode_http2_frame_segments`: thread a per-direction `DynamicTable` through the frame
  loop; append a "Header block (HPACK)" parent field whose children are the decoded headers, each
  with `byteOffset`/`byteLength` inside the frame.
- Demo-seed dev fixture updated so the dev browser shows real decoded headers.

Out (deferred / not needed):
- HPACK *encoding* (we only decode captured bytes).
- Reassembling a header block split across HEADERS + CONTINUATION frames into one decode call (each
  frame's fragment is decoded against the shared per-direction dynamic table; a fragment cut
  mid-representation stops gracefully - CONTINUATION spanning is rare for the single request/response
  purerequest issues).
- Any change to the send path, TLS/lower layers, or the response payload shape beyond richer
  HTTP/2 `Field`s.

## 2. Acceptance Criteria

- AC-001: A HEADERS frame with an indexed static-table field (e.g. `0x82` = `:method: GET`) decodes
  to a header field `:method: GET`, byte-located at the representation.
- AC-002: A literal-with-incremental-indexing field with Huffman-coded name and value decodes to
  the correct plaintext `name: value`.
- AC-003: A literal field with a raw (non-Huffman) string literal decodes correctly.
- AC-004: An HPACK integer that overflows its prefix (multi-byte continuation, e.g. index >= 62 or a
  string length >= 127) decodes to the correct value.
- AC-005: A literal-with-incremental-indexing field is inserted into the dynamic table so a later
  indexed reference (index >= 62) in the same direction resolves to it.
- AC-006: A dynamic table size update representation is decoded (and evicts entries past the new
  max), shown as its own field.
- AC-007: PADDED and PRIORITY prefixes on a HEADERS frame are skipped; the header block is decoded
  from the correct offset.
- AC-008: Every decoded header field carries `byteOffset`/`byteLength` within the frame segment so
  the hex view highlights the exact representation bytes.
- AC-009: A malformed/truncated header block never panics; it decodes what it can and stops.
- AC-010: The demo-seed dev fixture surfaces decoded HPACK headers; the Protocols tab renders them.

## 3. User Test Cases

- TC-001 (indexed static): frame `82` -> `:method: GET`. Maps: AC-001, AC-008.
- TC-002 (huffman literal): literal-inc-index name+value Huffman-coded -> plaintext. Maps: AC-002.
- TC-003 (raw literal): literal name+value, H flag clear -> plaintext. Maps: AC-003.
- TC-004 (integer continuation): index encoded across 2 bytes -> correct index. Maps: AC-004.
- TC-005 (dynamic table): literal-inc-index then indexed ref index 62 -> same header. Maps: AC-005.
- TC-006 (size update): `0x3F...` dynamic size update -> field present, table capped. Maps: AC-006.
- TC-007 (padded/priority): HEADERS with PADDED+PRIORITY flags -> block decoded past the prefixes. Maps: AC-007.
- TC-008 (truncated): a block cut mid-representation -> no panic, partial decode. Maps: AC-009.
- TC-009 (dev fixture): demo-seed HEADERS frame renders decoded headers in the tab. Maps: AC-010.

## 4. Data model

```rust
// hpack.rs
pub struct DynamicTable { /* VecDeque<(String, String)>, max_size, size */ }
pub struct DecodedHeader {
    pub name: String,
    pub value: String,
    pub kind: HeaderRepr,   // for the plain-language meaning
    pub byte_offset: usize, // offset within the decoded header block
    pub byte_len: usize,    // representation byte length
}
pub enum HeaderRepr { Indexed, LiteralIndexed, LiteralNoIndex, LiteralNeverIndexed, SizeUpdate }
```

`Dissection`/`Field`/`Segment` are unchanged - decoded headers map onto the existing `Field` shape
(label/value/meaning + byteOffset/byteLength + children).

## 5. Edge cases

- Index 0 in an indexed field is illegal (RFC): stop, do not panic.
- A string length or integer that runs past the block end: clamp, stop, no panic.
- Huffman padding: trailing bits must be all-ones and < 8 bits; a bad pad decodes what it can.
- Dynamic size update larger than the protocol max is accepted structurally (we only display).
- An empty header block (0-length HEADERS payload) yields no header children, no panic.
- PADDED with a pad length exceeding the payload: clamp to the payload, no panic.

## 6. Dependencies

No new crates. RFC 7541 static + Huffman tables are embedded as consts (Huffman table transcribed
from the locally-vendored, generated `h2` crate to avoid hand-transcription error). Frontend: no new
dep - decoded headers render through the existing generic `Field` renderer.
