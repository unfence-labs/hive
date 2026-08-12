import Foundation

enum ServerEndpoint {
    static let defaultPort = String(ServerConnectionStore.defaultPort)

    static func webSocketURL(path: String, queryItems: [URLQueryItem] = []) -> URL? {
        guard let connection = ServerConnectionStore.shared.snapshot() else { return nil }
        return webSocketURL(connection: connection, path: path, queryItems: queryItems)
    }

    static func webSocketURL(connection: ServerConnection, path: String, queryItems: [URLQueryItem] = []) -> URL? {
        webSocketURL(host: connection.host, port: String(connection.port), token: connection.authToken, path: path, queryItems: queryItems)
    }

    static func webSocketURL(host: String, port: String, token: String, path: String, queryItems: [URLQueryItem] = []) -> URL? {
        let normalizedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedHost.isEmpty,
              let portInt = Int(port.trimmingCharacters(in: .whitespacesAndNewlines)),
              (1...65_535).contains(portInt) else { return nil }
        var components = URLComponents()
        components.scheme = "ws"
        components.host = normalizedHost
        components.port = portInt
        components.path = path
        var query = queryItems
        if !token.isEmpty {
            query.append(URLQueryItem(name: "token", value: token))
        }
        if !query.isEmpty {
            components.queryItems = query
        }
        return components.url
    }
}
