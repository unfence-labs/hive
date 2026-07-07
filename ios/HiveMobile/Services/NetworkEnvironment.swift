import CFNetwork
import Foundation

enum NetworkEnvironment {
    /// Best-effort detection of an active VPN tunnel. iOS exposes no API to
    /// identify a specific VPN app (e.g. Tailscale), so this only reports whether
    /// some tunnel interface is currently routing traffic — treat it as a hint,
    /// not a guarantee.
    static func isVPNActive() -> Bool {
        guard let settings = CFNetworkCopySystemProxySettings()?.takeRetainedValue() as? [String: Any],
              let scoped = settings["__SCOPED__"] as? [String: Any] else {
            return false
        }
        let tunnelPrefixes = ["tap", "tun", "ppp", "ipsec", "utun"]
        return scoped.keys.contains { key in
            tunnelPrefixes.contains { key.hasPrefix($0) }
        }
    }
}
