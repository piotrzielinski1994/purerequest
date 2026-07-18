use std::net::SocketAddr;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

// One captured packet: the raw link-layer bytes plus the pcap linktype so the decoder knows
// the L2 framing (Ethernet vs the 4-byte loopback pseudo-header).
#[derive(Debug, Clone)]
pub struct CapturedPacket {
    pub linktype: i32,
    pub data: Vec<u8>,
}

// Result of a capture session: the raw packets seen on the connection's 4-tuple. Empty when
// capture is disabled, unavailable (no BPF permission), or no packets matched.
#[derive(Debug, Default, Clone)]
pub struct PacketCapture {
    pub packets: Vec<CapturedPacket>,
    // Set when capture was attempted but couldn't start (e.g. no permission) - lets the UI
    // explain why L2-L4 stayed facts-only instead of silently showing nothing.
    pub unavailable_reason: Option<String>,
}

// pcap linktype numbers we decode (mirror of pcap::Linktype constants; kept as plain i32 so
// this module has no hard pcap dependency in its public type).
pub const LINKTYPE_NULL: i32 = 0;
pub const LINKTYPE_ETHERNET: i32 = 1;
pub const LINKTYPE_LOOP: i32 = 108;

// Runtime gate. Live packet capture is OFF by default: it needs elevated privileges (BPF access)
// and is purely additive. `PUREREQUEST_PCAP=1` opts in.
pub fn is_enabled() -> bool {
    std::env::var("PUREREQUEST_PCAP").map(|v| v == "1").unwrap_or(false)
}

// A handle to a running capture thread. Dropping/joining it stops the capture and returns what
// was seen. The thread self-terminates after `max_duration` as a safety net so it can never
// outlive the send.
pub struct CaptureHandle {
    stop: mpsc::Sender<()>,
    join: thread::JoinHandle<PacketCapture>,
}

// How long the capture thread keeps draining after `finish()` is called, so packets still in
// the kernel buffer from a just-completed fast (localhost) exchange aren't dropped.
const DRAIN_LINGER: Duration = Duration::from_millis(150);

impl CaptureHandle {
    // Stop capturing and collect the packets. Signals a deadline (not an immediate stop) so the
    // thread drains any buffered packets first. Best-effort: a panicked thread yields empty.
    pub fn finish(self) -> PacketCapture {
        let _ = self.stop.send(());
        self.join.join().unwrap_or_default()
    }
}

// How long the caller blocks waiting for the capture to arm before giving up and proceeding
// with the send anyway (so a slow/failed capture can never stall a request).
const ARM_TIMEOUT: Duration = Duration::from_millis(500);

// Start capturing TCP packets before the send begins (so the SYN handshake is caught). We don't
// yet know the connection's ports (DNS + connect happen inside the send), so the BPF filter is a
// broad `tcp`; `filter_to_connection` narrows the collected packets to our 4-tuple afterwards.
// Returns None when capture is disabled. BLOCKS (up to ARM_TIMEOUT) until the capture is actually
// listening, so the send's SYN isn't missed to a device-open race - the whole point of capture.
pub fn start_unfiltered(max_duration: Duration) -> Option<CaptureHandle> {
    if !is_enabled() {
        return None;
    }
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<()>();
    let join = thread::spawn(move || run_capture("tcp", stop_rx, ready_tx, max_duration));
    // Wait until the capture thread signals it's armed (device open + filter set), or the arm
    // timeout elapses - either way we return and let the send proceed.
    let _ = ready_rx.recv_timeout(ARM_TIMEOUT);
    Some(CaptureHandle {
        stop: stop_tx,
        join,
    })
}

// Keep only the packets belonging to this connection (matched by the two TCP ports, which are
// unique to the connection on loopback and near-unique elsewhere). Cheap re-parse of each
// packet's port pair; leaves the raw bytes untouched for the full decode downstream.
pub fn filter_to_connection(
    mut capture: PacketCapture,
    local: Option<SocketAddr>,
    peer: Option<SocketAddr>,
) -> PacketCapture {
    let ports: Vec<u16> = [local.map(|a| a.port()), peer.map(|a| a.port())]
        .into_iter()
        .flatten()
        .collect();
    if ports.is_empty() {
        return capture;
    }
    capture.packets.retain(|packet| {
        packet_ports(packet)
            .map(|(src, dst)| ports.contains(&src) && ports.contains(&dst))
            .unwrap_or(false)
    });
    capture
}

// Extract (src_port, dst_port) from a captured packet by walking L2 -> L3 -> L4 offsets.
// Deliberately minimal (ports only); the full field decode lives in the dissect module.
fn packet_ports(packet: &CapturedPacket) -> Option<(u16, u16)> {
    let l3 = match packet.linktype {
        LINKTYPE_ETHERNET => 14,
        LINKTYPE_NULL | LINKTYPE_LOOP => 4,
        _ => return None,
    };
    let ip = packet.data.get(l3..)?;
    if ip.is_empty() {
        return None;
    }
    let (l4, protocol) = match ip[0] >> 4 {
        4 if ip.len() >= 20 => (l3 + (ip[0] & 0x0f) as usize * 4, ip[9]),
        6 if ip.len() >= 40 => (l3 + 40, ip[6]),
        _ => return None,
    };
    if protocol != 6 {
        return None;
    }
    let tcp = packet.data.get(l4..)?;
    if tcp.len() < 4 {
        return None;
    }
    Some((
        u16::from_be_bytes([tcp[0], tcp[1]]),
        u16::from_be_bytes([tcp[2], tcp[3]]),
    ))
}

// Pick the interface that carries real outbound traffic. `Device::lookup()` is unreliable on
// macOS (returns an addr-less pseudo-interface like `ap1`), so instead take the first Connected
// device that has a routable (non-loopback, non-link-local) IP address bound to it - which is the
// interface the default route uses for egress (en0 on Wi-Fi/Ethernet).
fn pick_default_device() -> Result<pcap::Device, String> {
    use pcap::{ConnectionStatus, Device};

    let devices = Device::list().map_err(|err| format!("device list failed: {err}"))?;
    devices
        .into_iter()
        .filter(|device| device.flags.connection_status == ConnectionStatus::Connected)
        .find(|device| device.addresses.iter().any(|addr| is_routable(&addr.addr)))
        .ok_or_else(|| "no connected capture device with a routable address found".to_string())
}

// A globally routable address (excludes loopback and link-local), i.e. one that identifies an
// egress interface rather than a pseudo/tunnel-only device.
fn is_routable(addr: &std::net::IpAddr) -> bool {
    match addr {
        std::net::IpAddr::V4(ip) => !ip.is_loopback() && !ip.is_link_local(),
        std::net::IpAddr::V6(ip) => !ip.is_loopback() && !is_ipv6_link_local(ip),
    }
}

// IPv6 link-local prefix fe80::/10 (Ipv6Addr::is_unicast_link_local is unstable, so check by hand).
fn is_ipv6_link_local(ip: &std::net::Ipv6Addr) -> bool {
    ip.segments()[0] & 0xffc0 == 0xfe80
}

fn run_capture(
    filter: &str,
    stop_rx: mpsc::Receiver<()>,
    ready_tx: mpsc::Sender<()>,
    max_duration: Duration,
) -> PacketCapture {
    use pcap::{Capture, Device};

    // An explicit device override (PUREREQUEST_PCAP_DEVICE, e.g. "lo0") wins over auto-detection.
    // Otherwise pick the interface carrying real outbound traffic (see `pick_default_device` -
    // NOT `Device::lookup()`, which on macOS often returns a bogus addr-less `ap1`).
    let device_name = std::env::var("PUREREQUEST_PCAP_DEVICE").ok();
    let device = match device_name {
        Some(name) => Device::from(name.as_str()),
        None => match pick_default_device() {
            Ok(device) => device,
            Err(reason) => {
                return PacketCapture {
                    unavailable_reason: Some(reason),
                    ..Default::default()
                }
            }
        },
    };

    let opened = Capture::from_device(device)
        .and_then(|inactive| {
            inactive
                .immediate_mode(true)
                .snaplen(262_144)
                .timeout(50)
                .open()
        })
        .and_then(|capture| capture.setnonblock());

    let mut capture = match opened {
        Ok(capture) => capture,
        // The common case on a locked-down box: BPF is root-only. Report it, don't panic.
        Err(err) => {
            return PacketCapture {
                unavailable_reason: Some(format!("capture unavailable ({err}) - needs BPF permission (run via a capture driver / elevated)")),
                ..Default::default()
            }
        }
    };

    let linktype = capture.get_datalink().0 as i32;
    if let Err(err) = capture.filter(filter, true) {
        return PacketCapture {
            unavailable_reason: Some(format!("filter failed: {err}")),
            ..Default::default()
        };
    }

    // Armed: device open + filter set. Unblock the caller so the send can start now, guaranteed
    // to be captured. (Send returns quickly if the receiver already timed out.)
    let _ = ready_tx.send(());

    let mut packets = Vec::new();
    let start = Instant::now();
    // When `finish()` fires the stop signal, keep draining until this deadline so buffered
    // packets from a just-completed fast exchange are still collected.
    let mut drain_until: Option<Instant> = None;
    loop {
        if stop_rx.try_recv().is_ok() && drain_until.is_none() {
            drain_until = Some(Instant::now() + DRAIN_LINGER);
        }
        if let Some(deadline) = drain_until {
            if Instant::now() >= deadline {
                break;
            }
        }
        if start.elapsed() >= max_duration {
            break;
        }
        match capture.next_packet() {
            Ok(packet) => packets.push(CapturedPacket {
                linktype,
                data: packet.data.to_vec(),
            }),
            // Nonblocking + timeout: no packet ready right now. Brief sleep, keep polling.
            Err(pcap::Error::TimeoutExpired) | Err(pcap::Error::NoMorePackets) => {
                thread::sleep(Duration::from_millis(2));
            }
            Err(_) => break,
        }
    }

    PacketCapture {
        packets,
        unavailable_reason: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    fn peer() -> SocketAddr {
        SocketAddr::new(IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)), 443)
    }

    // A minimal Ethernet+IPv4+TCP packet with the given TCP ports (rest zeroed).
    fn packet_with_ports(src: u16, dst: u16) -> CapturedPacket {
        let mut data = vec![0u8; 14]; // ethernet
        data[12] = 0x08; // ethertype IPv4
        let mut ipv4 = vec![0x45, 0, 0, 40, 0, 0, 0, 0, 64, 6, 0, 0, 127, 0, 0, 1, 127, 0, 0, 1];
        data.append(&mut ipv4);
        data.extend_from_slice(&src.to_be_bytes());
        data.extend_from_slice(&dst.to_be_bytes());
        data.extend_from_slice(&[0u8; 16]); // rest of TCP header
        CapturedPacket {
            linktype: LINKTYPE_ETHERNET,
            data,
        }
    }

    #[test]
    fn should_treat_only_globally_routable_ips_as_egress_addresses() {
        use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
        // Real egress addresses (en0's private-but-routable IPv4, a public IPv6).
        assert!(is_routable(&IpAddr::V4(Ipv4Addr::new(10, 93, 163, 170))));
        assert!(is_routable(&IpAddr::V6("2606:4700::1111".parse::<Ipv6Addr>().unwrap())));
        // Loopback + link-local are NOT egress (would mis-pick lo0 or an addr-less pseudo-iface).
        assert!(!is_routable(&IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
        assert!(!is_routable(&IpAddr::V4(Ipv4Addr::new(169, 254, 1, 1))));
        assert!(!is_routable(&IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(!is_routable(&IpAddr::V6("fe80::1".parse::<Ipv6Addr>().unwrap())));
    }

    #[test]
    fn should_be_disabled_unless_the_env_flag_is_set() {
        // Default (flag unset in the test process) -> start returns None, capturing nothing.
        assert!(start_unfiltered(Duration::from_millis(10)).is_none());
    }

    // LIVE capture end-to-end: arm capture on lo0, run a real loopback TCP exchange, assert real
    // packets were captured, filtered to the 4-tuple, and decode to sane TCP ports. Fully local
    // (no network egress). Ignored by default - needs PUREREQUEST_PCAP=1 + BPF access. Run:
    //   PUREREQUEST_PCAP=1 PUREREQUEST_PCAP_DEVICE=lo0 cargo test --lib pcap_capture -- --ignored --nocapture live_capture
    #[test]
    #[ignore = "needs PUREREQUEST_PCAP=1 + PUREREQUEST_PCAP_DEVICE=lo0 + BPF access; captures live loopback"]
    fn should_capture_live_loopback_end_to_end() {
        use std::io::{Read, Write};
        use std::net::{TcpListener, TcpStream};

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let addr = listener.local_addr().expect("addr");
        let server = std::thread::spawn(move || {
            if let Ok((mut sock, _)) = listener.accept() {
                let mut buf = [0u8; 16];
                let _ = sock.read(&mut buf);
                let _ = sock.write_all(b"pong-response-bytes");
            }
        });

        let handle = start_unfiltered(Duration::from_secs(5)).expect("capture must start (flag on)");

        let mut client = TcpStream::connect(addr).expect("connect loopback");
        let local = client.local_addr().ok();
        client.write_all(b"ping-request").expect("write");
        let mut resp = [0u8; 32];
        let _ = client.read(&mut resp);
        server.join().ok();
        std::thread::sleep(Duration::from_millis(250));

        let raw = handle.finish();
        println!(
            "captured {} raw packets, unavailable_reason={:?}",
            raw.packets.len(),
            raw.unavailable_reason
        );
        assert!(
            raw.unavailable_reason.is_none(),
            "capture should be available: {:?}",
            raw.unavailable_reason
        );
        assert!(!raw.packets.is_empty(), "expected raw loopback packets");

        let filtered = filter_to_connection(raw, local, Some(addr));
        println!("after 4-tuple filter: {} packets", filtered.packets.len());
        assert!(!filtered.packets.is_empty(), "expected connection packets");

        // Real headers decode: one of the captured packets carries this connection's server port.
        let ports: Vec<(u16, u16)> = filtered.packets.iter().filter_map(packet_ports).collect();
        assert!(
            ports.iter().any(|(s, d)| *s == addr.port() || *d == addr.port()),
            "decoded TCP ports should include the server port {}",
            addr.port()
        );
    }

    #[test]
    fn should_keep_only_packets_matching_the_connection_ports() {
        let local = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)), 51234);
        let raw = PacketCapture {
            packets: vec![
                packet_with_ports(51234, 443), // ours (outbound)
                packet_with_ports(443, 51234), // ours (inbound)
                packet_with_ports(60000, 443), // someone else's connection to the same host
            ],
            unavailable_reason: None,
        };
        let filtered = filter_to_connection(raw, Some(local), Some(peer()));
        assert_eq!(filtered.packets.len(), 2);
    }

    #[test]
    fn should_not_filter_when_no_ports_are_known() {
        let raw = PacketCapture {
            packets: vec![packet_with_ports(1, 2)],
            unavailable_reason: None,
        };
        let filtered = filter_to_connection(raw, None, None);
        assert_eq!(filtered.packets.len(), 1);
    }
}
