import Foundation

/// Pure matching/insertion logic for the composer's `#file`, `/command`, and
/// `@agent` autocompletes. Ports the web's semantics (`frontend/src/lib/
/// fuzzy-match.ts`, `completion.ts`, and `ChatInput.tsx` trigger detection) so
/// both clients rank and insert identically. The suggestion panel view stays
/// thin; everything here is unit-testable.
enum ComposerAutocomplete {

    enum Trigger: Character, Equatable {
        case command = "/"
        case agent = "@"
        case file = "#"
    }

    struct Active: Equatable {
        let trigger: Trigger
        let query: String
        /// Character offset of the trigger character in the draft.
        let triggerOffset: Int
    }

    /// Detect an open autocomplete at the end of the draft. Mirrors the web's
    /// `/(^|[\s])([/@#])(\S*)$/` over the text before the cursor; on mobile the
    /// cursor is treated as the end of the text. `/` and `@` require provider
    /// completion support; `#` is always available.
    static func detect(in text: String, supportsCompletions: Bool) -> Active? {
        guard !text.isEmpty else { return nil }

        var token = Substring(text)
        if let lastWhitespace = text.lastIndex(where: { $0.isWhitespace || $0.isNewline }) {
            token = text[text.index(after: lastWhitespace)...]
        }
        guard let first = token.first, let trigger = Trigger(rawValue: first) else { return nil }
        if trigger != .file && !supportsCompletions { return nil }

        return Active(
            trigger: trigger,
            query: String(token.dropFirst()),
            triggerOffset: text.distance(from: text.startIndex, to: token.startIndex)
        )
    }

    /// Replace the active trigger token with `insertion` plus a trailing space.
    /// `insertion` is the full token (`#src/git.ts`, `/compact`, `@reviewer`).
    static func inserting(_ insertion: String, into text: String, active: Active) -> String {
        guard active.triggerOffset <= text.count else { return text }
        let start = text.index(text.startIndex, offsetBy: active.triggerOffset)
        return text[..<start] + insertion + " "
    }

    /// Drop mentions whose `#displayName` token no longer appears in the draft.
    static func pruneMentions(_ mentions: [FileMention], text: String) -> [FileMention] {
        mentions.filter { text.contains("#\($0.displayName)") }
    }

    // MARK: - File matching

    struct FileMatch: Equatable, Identifiable {
        let path: String
        let basename: String
        var id: String { path }
    }

    /// Precomputed lowercased forms for a repository path so per-keystroke
    /// matching avoids re-lowercasing every candidate.
    struct FileCandidate {
        let path: String
        let basename: String
        let lowerName: String
        let lowerPath: String
    }

    static func prepareFiles(_ files: [String]) -> [FileCandidate] {
        files.map { path in
            let name = basename(of: path)
            return FileCandidate(
                path: path,
                basename: name,
                lowerName: name.lowercased(),
                lowerPath: path.lowercased()
            )
        }
    }

    /// Tiered fuzzy match over repository paths: basename exact > basename
    /// prefix > basename substring > path substring > path subsequence, ties
    /// broken by shorter path. Empty query lists the first files as-is.
    static func matchFiles(_ files: [String], query: String, limit: Int = 15) -> [FileMatch] {
        matchFiles(prepareFiles(files), query: query, limit: limit)
    }

    static func matchFiles(_ candidates: [FileCandidate], query: String, limit: Int = 15) -> [FileMatch] {
        if query.isEmpty {
            return candidates.prefix(limit).map { FileMatch(path: $0.path, basename: $0.basename) }
        }

        let q = query.lowercased()
        var scored: [(match: FileMatch, score: Int)] = []
        for candidate in candidates {
            let score: Int
            if candidate.lowerName == q { score = 100 }
            else if candidate.lowerName.hasPrefix(q) { score = 80 }
            else if candidate.lowerName.contains(q) { score = 60 }
            else if candidate.lowerPath.contains(q) { score = 40 }
            else if isSubsequence(q, of: candidate.lowerPath) { score = 20 }
            else { continue }

            scored.append((FileMatch(path: candidate.path, basename: candidate.basename), score))
        }

        return scored
            .sorted { $0.score != $1.score ? $0.score > $1.score : $0.match.path.count < $1.match.path.count }
            .prefix(limit)
            .map(\.match)
    }

    /// Shortest trailing path fragment that uniquely identifies `path` among
    /// files sharing its basename (`index.ts` → `api/index.ts`).
    static func disambiguate(_ path: String, in files: [String]) -> String {
        let name = basename(of: path)
        let duplicates = files.filter { basename(of: $0) == name }
        guard duplicates.count > 1 else { return name }

        let parts = path.split(separator: "/").map(String.init)
        for depth in 2...max(2, parts.count) {
            guard depth <= parts.count else { break }
            let candidate = parts.suffix(depth).joined(separator: "/")
            let unique = duplicates.allSatisfy { other in
                other == path || other.split(separator: "/").suffix(depth).joined(separator: "/") != candidate
            }
            if unique { return candidate }
        }
        return path
    }

    // MARK: - Command / agent matching

    /// Priority order of completion sources, mirroring the web's
    /// `COMPLETION_SOURCE_ORDER` so grouping and ranking match.
    private static let sourceOrder: [String] = [
        "builtin", "user_command", "project_command", "user_skill",
        "project_skill", "admin_skill", "plugin", "user_agent", "project_agent",
    ]

    static func sourceRank(_ source: String) -> Int {
        sourceOrder.firstIndex(of: source) ?? sourceOrder.count
    }

    /// Filter items of `type` ("slash_command" or "agent") by `query` over the
    /// command name, substring-or-better only, ordered by source priority then
    /// relevance. Empty query returns every item of the type in scan order.
    static func filterItems(_ items: [CompletionItem], type: String, query: String) -> [CompletionItem] {
        let typed = items.filter { $0.type == type }
        if query.isEmpty { return typed }

        let q = query.lowercased()
        return typed.enumerated()
            .compactMap { index, item -> (item: CompletionItem, index: Int, score: Int)? in
                let name = item.name.lowercased()
                let score: Int
                if name == q { score = 100 }
                else if name.hasPrefix(q) { score = 80 }
                else if name.contains(q) { score = 60 }
                else { return nil }
                return (item, index, score)
            }
            .sorted {
                let lhsRank = sourceRank($0.item.source)
                let rhsRank = sourceRank($1.item.source)
                if lhsRank != rhsRank { return lhsRank < rhsRank }
                if $0.score != $1.score { return $0.score > $1.score }
                return $0.index < $1.index
            }
            .map(\.item)
    }

    // MARK: - Helpers

    static func basename(of path: String) -> String {
        if let idx = path.lastIndex(of: "/") {
            return String(path[path.index(after: idx)...])
        }
        return path
    }

    /// True when every character of `query` appears in `text` in order.
    static func isSubsequence(_ query: String, of text: String) -> Bool {
        var qi = query.startIndex
        for char in text {
            guard qi < query.endIndex else { return true }
            if char == query[qi] { qi = query.index(after: qi) }
        }
        return qi == query.endIndex
    }
}
