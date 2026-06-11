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
        let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
        let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
        let token = UserDefaults.standard.string(forKey: "authToken") ?? ""
        guard var components = URLComponents(string: "http://\(host):\(port)\(source)") else {
            return nil
        }
        if !token.isEmpty {
            guard let encodedToken = token.addingPercentEncoding(withAllowedCharacters: tokenQueryAllowed) else {
                return nil
            }
            let tokenItem = "token=\(encodedToken)"
            if let query = components.percentEncodedQuery, !query.isEmpty {
                components.percentEncodedQuery = "\(query)&\(tokenItem)"
            } else {
                components.percentEncodedQuery = tokenItem
            }
        }
        return components.url
    }
}
