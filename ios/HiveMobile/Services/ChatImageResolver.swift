import Foundation

/// Resolves a chat image source string to a fetchable URL.
///
/// Mirrors `frontend/src/lib/image-url.ts` `resolveImageSrc`: `data:` URLs are
/// decoded inline (handled by the loader, not here), while `/api/...` paths get
/// the configured server base and the auth token appended as a query param.
enum ChatImageResolver {
    private static let tokenQueryAllowed: CharacterSet = {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.~")
        return allowed
    }()

    static func apiURL(for source: String) -> URL? {
        guard source.hasPrefix("/api/") else { return nil }
        guard let connection = ServerConnectionStore.shared.snapshot() else { return nil }
        guard var components = URLComponents(string: source) else { return nil }
        components.scheme = "http"
        components.host = connection.host
        components.port = connection.port
        guard components.url != nil else {
            return nil
        }
        guard let encodedToken = connection.authToken.addingPercentEncoding(withAllowedCharacters: tokenQueryAllowed) else {
            return nil
        }
        let tokenItem = "token=\(encodedToken)"
        if let query = components.percentEncodedQuery, !query.isEmpty {
            components.percentEncodedQuery = "\(query)&\(tokenItem)"
        } else {
            components.percentEncodedQuery = tokenItem
        }
        return components.url
    }
}
