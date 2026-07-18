# Plan: h2-hpack-decode

## Approach

Hand-roll an HPACK (RFC 7541) decoder in a new `src-tauri/src/hpack.rs`, then wire it into the
existing `dissect.rs` HTTP/2 frame decoder. Hand-rolled (not a crate) because: (1) the whole
`dissect.rs` layer decodes bytes by hand to attach exact byte offsets for the hex-highlight
contract - a library returns headers, not offsets; (2) no HPACK-decoder crate is in the lock (`h2`
keeps HPACK private); (3) the epic's stated design is byte-level hand decoding. Static + Huffman
tables are transcribed from the vendored, generated `h2` crate to avoid transcription error.

Pure core (`decode_block`) is unit-tested in isolation; the `dissect.rs` wiring is covered by the
existing HTTP/2 frame tests extended with header assertions.

## Files

- **New** `src-tauri/src/hpack.rs`: `DynamicTable`, `DecodedHeader`, `HeaderRepr`, `decode_block`,
  integer/string/Huffman decoders, `STATIC_TABLE`, `HUFFMAN_TABLE`. Own `#[cfg(test)]` module.
- **Modify** `src-tauri/src/lib.rs`: add `mod hpack;`.
- **Modify** `src-tauri/src/dissect.rs`: thread a per-direction `DynamicTable` through
  `decode_http2_frame_segments`; for HEADERS/CONTINUATION/PUSH_PROMISE, skip PADDED/PRIORITY
  prefixes, call `hpack::decode_block`, append a "Header block (HPACK)" `Field` with one
  byte-located child per decoded header.
- **Modify** `src/lib/workspace/demo-seed.ts`: give the dev HEADERS frame a real HPACK block so the
  tab shows decoded headers (AC-010).

## Key decisions

- Per-direction dynamic table: sent frames and received frames each keep their own `DynamicTable`
  (HPACK is directional). Threaded as two locals in the layer-7 assembly, not global state.
- Decode is best-effort: any structural error (index 0, run past end, bad Huffman) stops the block
  and returns what decoded so far - matches the rest of `dissect.rs` (never panics on wire input).
- Byte offsets are measured within the header-block fragment, then rebased to the frame segment
  (block starts at frame offset 9 + PADDED/PRIORITY prefix len).

## Edge cases (from spec s5)

Index 0 illegal; string/int run past end; Huffman bad pad; oversized size update; empty block;
PADDED pad-length > payload. All clamp/stop, none panic. Covered by TC-004/006/007/008.

## Tests (RED first, one per AC minimum)

Pure `hpack` module tests: indexed static (AC-001), Huffman literal (AC-002), raw literal (AC-003),
integer continuation (AC-004), dynamic insert+ref (AC-005), size update+eviction (AC-006),
truncated no-panic (AC-009). `dissect.rs` tests: PADDED+PRIORITY skip (AC-007), header field
byte-located under the frame (AC-008). Frontend: demo-seed fixture renders (AC-010) - covered by the
existing response-pane test extended, or a new assertion.

## Acceptance verification

`cargo test` (hpack + dissect suites green), `npm test` (frontend green), `cargo clippy` clean.
Live: `PUREREQUEST_TAP_CLIENT` default + an h2 endpoint -> Protocols tab shows decoded request/response
headers with hex highlight. Traceability table filled in the task file.
