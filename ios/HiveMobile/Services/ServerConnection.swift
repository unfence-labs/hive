import Foundation

struct ServerConnection: Equatable, Sendable {
    let host: String
    let port: Int
    let authToken: String

    init?(host: String, port: String, authToken: String) {
        guard let parsedPort = Int(port.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return nil
        }
        self.init(host: host, port: parsedPort, authToken: authToken)
    }

    init?(host: String, port: Int, authToken: String) {
        let normalizedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedToken = authToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedHost.isEmpty,
              (1...65_535).contains(port),
              !normalizedToken.isEmpty else {
            return nil
        }
        self.host = normalizedHost
        self.port = port
        self.authToken = normalizedToken
    }
}

final class ServerConnectionStore: @unchecked Sendable {
    static let shared = ServerConnectionStore()

    static let defaultPort = 9_420

    private enum Key {
        static let host = "hive.server.connection.host"
        static let port = "hive.server.connection.port"
    }

    private let lock = NSLock()
    private let defaults: UserDefaults
    private let tokenStore: any TokenStore

    init(
        defaults: UserDefaults = .standard,
        tokenStore: any TokenStore = KeychainTokenStore()
    ) {
        self.defaults = defaults
        self.tokenStore = tokenStore
    }

    func snapshot() -> ServerConnection? {
        lock.withLock {
            guard let host = defaults.string(forKey: Key.host) else {
                return nil
            }
            let storedPort = defaults.object(forKey: Key.port) == nil
                ? Self.defaultPort
                : defaults.integer(forKey: Key.port)
            guard let token = try? tokenStore.load(for: tokenIdentifier(host: host, port: storedPort)) else {
                return nil
            }
            return ServerConnection(host: host, port: storedPort, authToken: token)
        }
    }

    var hasConfiguration: Bool {
        snapshot() != nil
    }

    func replace(with connection: ServerConnection) throws {
        try lock.withLock {
            try tokenStore.save(
                connection.authToken,
                for: tokenIdentifier(host: connection.host, port: connection.port)
            )
            defaults.set(connection.host, forKey: Key.host)
            defaults.set(connection.port, forKey: Key.port)
        }
    }

    private func tokenIdentifier(host: String, port: Int) -> String {
        "\(host.lowercased()):\(port)"
    }
}
