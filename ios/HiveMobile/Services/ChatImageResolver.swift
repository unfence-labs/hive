import Foundation

/// Resolves a chat image source string to a fetchable URL.
///
/// Mirrors `frontend/src/lib/image-url.ts` `resolveImageSrc`: `data:` URLs are
/// decoded inline (handled by the loader, not here), while `/api/...` paths get
/// the configured server base and the auth token appended as a query param.
enum ChatImageResolver {
    static func apiURL(for source: String) -> URL? {
        guard source.hasPrefix("/api/") else { return nil }
        let host = UserDefaults.standard.string(forKey: "serverHost") ?? "localhost"
        let port = UserDefaults.standard.string(forKey: "serverPort") ?? "3000"
        let token = UserDefaults.standard.string(forKey: "authToken") ?? ""
        var urlString = "http://\(host):\(port)\(source)"
        if !token.isEmpty {
            let separator = source.contains("?") ? "&" : "?"
            urlString += "\(separator)token=\(token)"
        }
        return URL(string: urlString)
    }
}
