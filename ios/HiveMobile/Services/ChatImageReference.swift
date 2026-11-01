import Foundation

/// Maps server-side image references to authenticated media routes. A filesystem
/// path belongs to the current workspace, never to the phone's filesystem.
/// The backend remains responsible for containment and symlink validation.
enum ChatImageReference {
    private static let imageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "avif", "tif", "tiff", "bmp"
    ]

    static func source(for url: URL, workspaceId: String?) -> String? {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: true),
              components.user == nil, components.password == nil, components.port == nil else { return nil }

        // Never reinterpret a remote origin as an authenticated Hive resource.
        if let scheme = components.scheme {
            guard scheme.lowercased() == "file",
                  components.host == nil || components.host == "" || components.host == "localhost" else { return nil }
        } else if components.host != nil || url.absoluteString.hasPrefix("//") {
            return nil
        }

        let path = components.path
        guard !path.isEmpty, !path.contains("\\"),
              !path.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) else { return nil }

        if components.scheme == nil, path.hasPrefix("/api/") {
            guard isImageAPIPath(path, queryItems: components.queryItems ?? []) else { return nil }
            components.fragment = nil
            // Authentication always comes from the current connection, not a
            // stale token copied into a model-generated link.
            components.queryItems = components.queryItems?.filter { $0.name != "token" }
            components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
            return components.string
        }

        guard isImagePath(path), let workspaceId, !workspaceId.isEmpty else { return nil }
        let segmentCharacters = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        guard let encodedWorkspaceId = workspaceId.addingPercentEncoding(withAllowedCharacters: segmentCharacters) else { return nil }

        var result = URLComponents()
        result.percentEncodedPath = workspaceId == "brain"
            ? "/api/brain/file/raw"
            : "/api/workspaces/\(encodedWorkspaceId)/file/raw"
        result.queryItems = [URLQueryItem(name: "path", value: path)]
        // '+' is a literal filename character, but form-style query decoders
        // otherwise interpret it as a space.
        result.percentEncodedQuery = result.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        return result.string
    }

    private static func isImagePath(_ path: String) -> Bool {
        imageExtensions.contains((path as NSString).pathExtension.lowercased())
    }

    private static func isImageAPIPath(_ path: String, queryItems: [URLQueryItem]) -> Bool {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        let workspaceFile = parts.count == 6 && parts[1] == "api" && parts[2] == "workspaces"
            && !parts[3].isEmpty && parts[4] == "file" && parts[5] == "raw"
        if workspaceFile || path == "/api/brain/file/raw" {
            let paths = queryItems.filter { $0.name == "path" }
            return paths.count == 1 && paths[0].value.map(isImagePath) == true
        }
        return parts.count == 8 && parts[1] == "api" && parts[2] == "workspaces"
            && !parts[3].isEmpty && parts[4] == "sessions" && !parts[5].isEmpty
            && parts[6] == "attachments" && isImagePath(String(parts[7]))
    }
}
