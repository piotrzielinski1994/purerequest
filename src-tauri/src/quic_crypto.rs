use aes::cipher::{Array, BlockCipherEncrypt, KeyInit};
use aes::{Aes128, Aes256};
use chacha20::cipher::{KeyIvInit, StreamCipher, StreamCipherSeek};
use chacha20::ChaCha20;
use ring::{aead, hkdf};

// RFC 9001 §5.2 initial salt for QUIC version 1.
pub const INITIAL_SALT_V1: [u8; 20] = [
    0x38, 0x76, 0x2c, 0xf7, 0xf5, 0x59, 0x34, 0xb3, 0x4d, 0x17, 0x9a, 0xe6, 0xa4, 0xc8, 0x0c, 0xad,
    0xcc, 0xbb, 0x7f, 0x0a,
];

// The AEAD + header-protection cipher a packet's keys are for, selected from the
// negotiated TLS 1.3 cipher suite (RFC 9001 §5.3/§5.4). Non-AES-128 variants are the
// crypto surface the dissector selects per negotiated suite; wired in the dissection task.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Suite {
    Aes128Gcm,
    Aes256Gcm,
    ChaCha20Poly1305,
}

// The three packet-protection secrets derived from one traffic secret (RFC 9001 §5.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PacketKeys {
    pub key: Vec<u8>,
    pub iv: Vec<u8>,
    pub hp: Vec<u8>,
}

struct HkdfLen(usize);

impl hkdf::KeyType for HkdfLen {
    fn len(&self) -> usize {
        self.0
    }
}

// TLS 1.3 HKDF-Expand-Label (RFC 8446 §7.1) with a zero-length context, as QUIC uses it. `label`
// is the bare QUIC label (e.g. `quic key`); the `tls13 ` prefix is added here. `algorithm` selects
// the suite hash - SHA-256 for the initial-secret + AES-128/ChaCha20 suites, SHA-384 for AES-256.
pub fn hkdf_expand_label_hash(
    secret: &[u8],
    label: &[u8],
    length: usize,
    algorithm: hkdf::Algorithm,
) -> Vec<u8> {
    let prk = hkdf::Prk::new_less_safe(algorithm, secret);
    expand_from_prk(&prk, label, length)
}

// The HKDF hash a suite's key schedule uses.
fn suite_hash(suite: Suite) -> hkdf::Algorithm {
    match suite {
        Suite::Aes256Gcm => hkdf::HKDF_SHA384,
        Suite::Aes128Gcm | Suite::ChaCha20Poly1305 => hkdf::HKDF_SHA256,
    }
}

// RFC 9001 §5.2: HKDF-Extract(initial_salt, dcid) then Expand-Label with
// `client in` / `server in` to the 32-byte initial traffic secrets.
pub fn initial_secrets(dcid: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, &INITIAL_SALT_V1).extract(dcid);
    let client = expand_from_prk(&prk, b"client in", 32);
    let server = expand_from_prk(&prk, b"server in", 32);
    (client, server)
}

// RFC 9001 §5.2: the Initial packet-protection keys for one direction, derived from the client's
// Destination Connection ID. Initial packets always use AEAD_AES_128_GCM (SHA-256 key schedule),
// so no secret from the key log is needed - the DCID alone is enough.
pub fn initial_keys_for(dcid: &[u8], from_client: bool) -> PacketKeys {
    let (client, server) = initial_secrets(dcid);
    let secret = if from_client { client } else { server };
    derive_packet_keys(&secret, Suite::Aes128Gcm)
}

// RFC 9001 §5.1: derive key/iv/hp from a traffic secret. Key + hp lengths follow the
// suite (AES-128 → 16, AES-256 / ChaCha20 → 32); iv is always 12.
pub fn derive_packet_keys(secret: &[u8], suite: Suite) -> PacketKeys {
    let key_len = match suite {
        Suite::Aes128Gcm => 16,
        Suite::Aes256Gcm | Suite::ChaCha20Poly1305 => 32,
    };
    let hash = suite_hash(suite);
    PacketKeys {
        key: hkdf_expand_label_hash(secret, b"quic key", key_len, hash),
        iv: hkdf_expand_label_hash(secret, b"quic iv", 12, hash),
        hp: hkdf_expand_label_hash(secret, b"quic hp", key_len, hash),
    }
}

// RFC 9001 §5.4.1: the 5-byte header-protection mask from a 16-byte ciphertext sample.
// AES suites run AES-ECB(hp, sample); ChaCha20 runs the ChaCha20 block with hp as key,
// sample[0..4] as the counter and sample[4..16] as the nonce.
pub fn header_protection_mask(hp: &[u8], sample: &[u8], suite: Suite) -> [u8; 5] {
    let mut mask = [0u8; 5];
    match suite {
        Suite::Aes128Gcm => {
            let cipher = Aes128::new_from_slice(hp).expect("16-byte aes-128 hp key");
            let mut block = Array::<u8, _>::try_from(&sample[..16]).expect("16-byte sample");
            cipher.encrypt_block(&mut block);
            mask.copy_from_slice(&block[..5]);
        }
        Suite::Aes256Gcm => {
            let cipher = Aes256::new_from_slice(hp).expect("32-byte aes-256 hp key");
            let mut block = Array::<u8, _>::try_from(&sample[..16]).expect("16-byte sample");
            cipher.encrypt_block(&mut block);
            mask.copy_from_slice(&block[..5]);
        }
        Suite::ChaCha20Poly1305 => {
            // RFC 9001 §5.4.4: counter = sample[0..4] (LE), nonce = sample[4..16];
            // the mask is the keystream applied to five zero bytes.
            let key = Array::<u8, _>::try_from(hp).expect("32-byte chacha hp key");
            let nonce = Array::<u8, _>::try_from(&sample[4..16]).expect("12-byte nonce");
            let mut cipher = ChaCha20::new(&key, &nonce);
            let counter = u32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]);
            cipher.seek((counter as u64) * 64);
            cipher.apply_keystream(&mut mask);
        }
    }
    mask
}

// RFC 9001 §5.3: AEAD-open a protected payload. `nonce = iv XOR left-padded packet
// number`; the authenticated data is the (unprotected) packet header; `ciphertext`
// includes the trailing auth tag. Returns the plaintext or Err on auth failure.
pub fn aead_open(
    key: &[u8],
    iv: &[u8],
    packet_number: u64,
    header: &[u8],
    ciphertext: &[u8],
    suite: Suite,
) -> Result<Vec<u8>, ()> {
    let unbound = aead::UnboundKey::new(aead_algorithm(suite), key).map_err(|_| ())?;
    let opening = aead::LessSafeKey::new(unbound);

    // RFC 9001 §5.3: nonce = iv XOR the packet number, right-aligned in the 12-byte field.
    let mut nonce_bytes = [0u8; 12];
    nonce_bytes.copy_from_slice(iv);
    for (offset, byte) in packet_number.to_be_bytes().iter().enumerate() {
        nonce_bytes[4 + offset] ^= byte;
    }

    let mut in_out = ciphertext.to_vec();
    let plaintext = opening
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce_bytes),
            aead::Aad::from(header),
            &mut in_out,
        )
        .map_err(|_| ())?;
    Ok(plaintext.to_vec())
}

fn expand_from_prk(prk: &hkdf::Prk, label: &[u8], length: usize) -> Vec<u8> {
    let full_label = [b"tls13 ", label].concat();
    let mut info = Vec::with_capacity(4 + full_label.len());
    info.extend_from_slice(&(length as u16).to_be_bytes());
    info.push(full_label.len() as u8);
    info.extend_from_slice(&full_label);
    info.push(0);
    let info_slices = [info.as_slice()];
    let okm = prk
        .expand(&info_slices, HkdfLen(length))
        .expect("hkdf expand length within bounds");
    let mut out = vec![0u8; length];
    okm.fill(&mut out).expect("okm fill matches length");
    out
}

fn aead_algorithm(suite: Suite) -> &'static aead::Algorithm {
    match suite {
        Suite::Aes128Gcm => &aead::AES_128_GCM,
        Suite::Aes256Gcm => &aead::AES_256_GCM,
        Suite::ChaCha20Poly1305 => &aead::CHACHA20_POLY1305,
    }
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

    // The RFC 9001 Appendix-A client-chosen Destination Connection ID.
    const DCID: &str = "8394c8f03e515708";

    // TC-011 → AC-010: the RFC 9001 §A.1 initial-secret derivation reproduces the exact
    // published client + server key/iv/hp for the sample DCID. Pins HKDF-Expand-Label
    // (the QUIC labels) + the initial-salt derivation against the authoritative vector.
    #[test]
    fn should_derive_rfc9001_initial_keys_for_the_sample_dcid() {
        let (client_secret, server_secret) = initial_secrets(&hx(DCID));

        assert_eq!(
            client_secret,
            hx("c00cf151ca5be075ed0ebfb5c80323c4 2d6b7db67881289af4008f1f6c357aea"),
            "client_initial_secret"
        );
        assert_eq!(
            server_secret,
            hx("3c199828fd139efd216c155ad844cc81 fb82fa8d7446fa7d78be803acdda951b"),
            "server_initial_secret"
        );

        let client = derive_packet_keys(&client_secret, Suite::Aes128Gcm);
        assert_eq!(client.key, hx("1f369613dd76d5467730efcbe3b1a22d"), "client key");
        assert_eq!(client.iv, hx("fa044b2f42a3fd3b46fb255c"), "client iv");
        assert_eq!(client.hp, hx("9f50449e04a0e810283a1e9933adedd2"), "client hp");

        let server = derive_packet_keys(&server_secret, Suite::Aes128Gcm);
        assert_eq!(server.key, hx("cf3a5331653c364c88f0f379b6067e37"), "server key");
        assert_eq!(server.iv, hx("0ac1493ca1905853b0bba03e"), "server iv");
        assert_eq!(server.hp, hx("c206b8d9b9f0f37644430b490eeaa314"), "server hp");
    }

    // TC-011 → AC-010: the RFC 9001 §A.2 header-protection sample produces the exact
    // published 5-byte mask under AES (AES-ECB of the sample with the client hp key).
    #[test]
    fn should_reproduce_the_rfc9001_header_protection_mask() {
        let (client_secret, _) = initial_secrets(&hx(DCID));
        let hp = derive_packet_keys(&client_secret, Suite::Aes128Gcm).hp;
        let sample = hx("d1b1c98dd7689fb8ec11d242b123dc9b");

        let mask = header_protection_mask(&hp, &sample, Suite::Aes128Gcm);

        assert_eq!(&mask[..], &hx("437b9aec36")[..], "RFC 9001 A.2 mask");
    }

    // TC-011 → AC-010: AEAD-open the full RFC 9001 §A.2 client Initial packet. The 16-byte
    // GCM tag authenticates every ciphertext + header byte, so a successful open proves the
    // whole transcription AND the nonce (iv XOR pn) + AAD (unprotected header) construction.
    // The plaintext must begin with the published CRYPTO frame and pad with zeros to 1162.
    #[test]
    fn should_aead_open_the_rfc9001_client_initial_payload() {
        let (client_secret, _) = initial_secrets(&hx(DCID));
        let keys = derive_packet_keys(&client_secret, Suite::Aes128Gcm);

        // The unprotected header (RFC 9001 §A.2), packet number = 2.
        let header = hx("c300000001088394c8f03e5157080000449e00000002");
        let packet_number = 2u64;

        // The full protected packet (§A.2); the ciphertext is everything after the
        // 22-byte header. Its length must be 1200 bytes (22 header + 1178 payload).
        let protected = hx(concat!(
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
        ));
        assert_eq!(protected.len(), 1200, "RFC 9001 A.2 packet is 1200 bytes");
        let ciphertext = &protected[22..];

        let plaintext = aead_open(
            &keys.key,
            &keys.iv,
            packet_number,
            &header,
            ciphertext,
            Suite::Aes128Gcm,
        )
        .expect("A.2 packet must AEAD-open with the derived client keys");

        // §A.2 CRYPTO frame (the ClientHello), then PADDING (zeros) to a 1162-byte payload.
        let crypto_frame = hx(concat!(
            "060040f1010000ed0303ebf8fa56f12939b9584a3896472ec40bb863cfd3e868",
            "04fe3a47f06a2b69484c000004130113 02010000c000000010000e00000b6578",
            "616d706c652e636f6dff01000100000a 00080006001d00170018001000070005",
            "04616c706e0005000501000000000033 00260024001d00209370b2c9caa47fba",
            "baf4559fedba753de171fa71f50f1ce1 5d43e994ec74d748002b000302030400",
            "0d0010000e0403050306030203080408 050806002d00020101001c0002400100",
            "3900320408ffffffffffffffff050480 00ffff07048000ffff08011001048000",
            "75300901100f088394c8f03e51570806 048000ffff",
        ));
        assert_eq!(plaintext.len(), 1162, "payload padded to 1162 bytes");
        assert_eq!(
            &plaintext[..crypto_frame.len()],
            &crypto_frame[..],
            "decrypted CRYPTO frame matches RFC 9001 A.2"
        );
        assert!(
            plaintext[crypto_frame.len()..].iter().all(|&b| b == 0),
            "the remainder is PADDING (zero) frames"
        );
    }

    // AEAD self-consistency for the ChaCha20-Poly1305 suite (no RFC vector transcribed
    // here): a value sealed with ring under our nonce/AAD construction opens back to the
    // same plaintext, and a tampered AAD fails. Guards the non-AES suite path (E-4).
    #[test]
    fn should_open_what_it_seals_for_chacha_and_reject_tampered_aad() {
        let key = hx("0000000000000000000000000000000000000000000000000000000000000001");
        let iv = hx("000000000000000000000042");
        let header = b"quic-header";
        let pn = 7u64;
        let plaintext = b"hello quic dissection";

        let alg = aead_algorithm(Suite::ChaCha20Poly1305);
        let sealing = aead::LessSafeKey::new(aead::UnboundKey::new(alg, &key).unwrap());
        let mut nonce_bytes = [0u8; 12];
        nonce_bytes.copy_from_slice(&iv);
        for (i, b) in pn.to_be_bytes().iter().enumerate() {
            nonce_bytes[4 + i] ^= b;
        }
        let mut sealed = plaintext.to_vec();
        sealing
            .seal_in_place_append_tag(
                aead::Nonce::assume_unique_for_key(nonce_bytes),
                aead::Aad::from(&header[..]),
                &mut sealed,
            )
            .unwrap();

        let opened = aead_open(&key, &iv, pn, header, &sealed, Suite::ChaCha20Poly1305)
            .expect("round-trip open");
        assert_eq!(opened, plaintext);

        let tampered = aead_open(&key, &iv, pn, b"wrong-header", &sealed, Suite::ChaCha20Poly1305);
        assert!(tampered.is_err(), "AAD mismatch must fail the tag check");
    }
}
