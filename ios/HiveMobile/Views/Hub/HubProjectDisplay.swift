import Foundation

struct HubProjectDisplayName {
    let owner: String?
    let repo: String

    var plain: String {
        if let owner { "\(owner)/\(repo)" } else { repo }
    }
}

enum HubProjectDisplay {
    static func name(for project: Project) -> HubProjectDisplayName {
        if let url = project.url, let parts = ownerAndRepo(from: url) {
            return HubProjectDisplayName(owner: parts.owner, repo: parts.repo)
        }
        if let parts = ownerAndRepo(from: project.name) {
            return HubProjectDisplayName(owner: parts.owner, repo: parts.repo)
        }
        return HubProjectDisplayName(owner: nil, repo: project.name)
    }

    static func ownerAndRepo(from rawInput: String) -> (owner: String, repo: String)? {
        let trimmed = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let noTrailingSlash = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
        let noGitSuffix = noTrailingSlash.hasSuffix(".git") ? String(noTrailingSlash.dropLast(4)) : noTrailingSlash

        if let url = URL(string: noGitSuffix), url.scheme != nil {
            let pathParts = url.pathComponents.filter { $0 != "/" && !$0.isEmpty }
            if pathParts.count >= 2 {
                return (pathParts[pathParts.count - 2], pathParts[pathParts.count - 1])
            }
        }

        let normalized = noGitSuffix.replacingOccurrences(of: ":", with: "/")
        let parts = normalized.split(separator: "/").map(String.init)
        guard parts.count >= 2 else { return nil }

        let repo = parts[parts.count - 1]
        let owner = parts[parts.count - 2]
        if owner.contains("@") || owner.contains(".") || repo.isEmpty {
            return nil
        }
        return (owner, repo)
    }
}
