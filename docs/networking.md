# Networking

Hive V1 does not configure networking or provide HTTPS. Before setup, the operator must establish
an encrypted private network that reaches the server. The desktop app, browser, and iOS client must
connect through the server's private address.

Tailscale, WireGuard, another VPN, or a cloud provider's private network are examples, not Hive
dependencies. Hive does not install or configure them.

The backend binds all interfaces on port `9420` by default. Firewall rules, routing, and keeping
that port private remain the operator's responsibility. Never expose port `9420` directly to the
public Internet: the access token is sent over HTTP and WebSocket and can be intercepted on an
untrusted network.

Direct public access and HTTPS termination are unsupported in V1.
