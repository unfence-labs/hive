import Foundation

enum ServerEndpoint {
    static func webSocketURL(path: String, queryItems: [URLQueryItem] = []) -> URL? {
        webSocketURL(
            host: UserDefaults.standard.string(forKey: "serverHost") ?? "localhost",
            port: UserDefaults.standard.string(forKey: "serverPort") ?? "3000",
            token: UserDefaults.standard.string(forKey: "authToken") ?? "",
            path: path,
            queryItems: queryItems
        )
    }

    static func webSocketURL(host: String, port: String, token: String, path: String, queryItems: [URLQueryItem] = []) -> URL? {
        guard !host.isEmpty, let portInt = Int(port) else { return nil }
        var components = URLComponents()
        components.scheme = "ws"
        components.host = host
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
