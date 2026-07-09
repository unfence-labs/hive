import Foundation

struct WorkspaceFileDiff: Equatable {
    let path: String
    let renamedFrom: String?
    let text: String
    let isBinary: Bool
}

func splitUnifiedDiff(_ raw: String) -> [WorkspaceFileDiff] {
    var result: [WorkspaceFileDiff] = []
    var header: [String] = []
    var hunks: [String] = []
    var inHunks = false
    var started = false

    func flush() {
        guard started else { return }
        var path: String?
        var oldPath: String?
        var renamedFrom: String?
        var isBinary = false
        for line in header {
            if line.hasPrefix("+++ b/") { path = String(line.dropFirst(6)) }
            else if line.hasPrefix("--- a/") { oldPath = String(line.dropFirst(6)) }
            else if line.hasPrefix("rename to ") { path = String(line.dropFirst(10)) }
            else if line.hasPrefix("rename from ") { renamedFrom = String(line.dropFirst(12)) }
            else if line.hasPrefix("Binary files ") || line.hasPrefix("GIT binary patch") { isBinary = true }
            else if path == nil, line.hasPrefix("diff --git "), let range = line.range(of: " b/") {
                path = String(line[range.upperBound...])
            }
        }
        let resolved = path ?? oldPath
        guard let resolved else { return }
        result.append(WorkspaceFileDiff(
            path: resolved,
            renamedFrom: renamedFrom,
            text: hunks.joined(separator: "\n"),
            isBinary: isBinary
        ))
    }

    for raw in raw.split(separator: "\n", omittingEmptySubsequences: false) {
        let line = String(raw)
        if line.hasPrefix("diff --git ") {
            flush()
            header = [line]
            hunks = []
            inHunks = false
            started = true
            continue
        }
        guard started else { continue }
        if line.hasPrefix("@@") { inHunks = true }
        if inHunks {
            hunks.append(line)
        } else {
            header.append(line)
        }
    }
    flush()
    return result
}

struct DiffLine: Identifiable, Equatable {
    enum Kind {
        case context
        case added
        case removed
        case hunk
    }

    let id: Int
    let kind: Kind
    let text: String

    var prefix: String {
        switch kind {
        case .context, .hunk: " "
        case .added: "+"
        case .removed: "-"
        }
    }
}

func parseDiffStats(_ diff: String) -> (added: Int, removed: Int) {
    var added = 0
    var removed = 0
    for line in diff.split(separator: "\n", omittingEmptySubsequences: false) {
        if line.hasPrefix("+") && !line.hasPrefix("+++") {
            added += 1
        } else if line.hasPrefix("-") && !line.hasPrefix("---") {
            removed += 1
        }
    }
    return (added, removed)
}

func parseUnifiedDiffLines(_ diff: String, includeHunkMarkers: Bool = false) -> [DiffLine] {
    var result: [DiffLine] = []
    var index = 0
    for raw in diff.split(separator: "\n", omittingEmptySubsequences: false) {
        let line = String(raw)
        if line.hasPrefix("@@") {
            if includeHunkMarkers, !result.isEmpty {
                result.append(DiffLine(id: index, kind: .hunk, text: ""))
                index += 1
            }
            continue
        }
        if line.hasPrefix("+++") || line.hasPrefix("---") { continue }
        if line.hasPrefix("+") {
            result.append(DiffLine(id: index, kind: .added, text: String(line.dropFirst())))
            index += 1
        } else if line.hasPrefix("-") {
            result.append(DiffLine(id: index, kind: .removed, text: String(line.dropFirst())))
            index += 1
        } else {
            let text = line.hasPrefix(" ") ? String(line.dropFirst()) : line
            result.append(DiffLine(id: index, kind: .context, text: text))
            index += 1
        }
    }
    return result
}

struct DiffComment: Identifiable, Equatable {
    let id = UUID()
    let file: String
    let line: String
    var snippet: String?
    var text: String
}

struct DiffSegment: Identifiable {
    let id: Int
    let lines: [DiffLine]
    let comments: [DiffComment]
}

func segmentDiffLines(_ lines: [DiffLine], comments: [DiffComment]) -> [DiffSegment] {
    var segments: [DiffSegment] = []
    var current: [DiffLine] = []
    var remaining = comments
    for line in lines {
        current.append(line)
        let matching = remaining.filter { $0.line == line.text }
        if !matching.isEmpty {
            remaining.removeAll { candidate in matching.contains { $0.id == candidate.id } }
            segments.append(DiffSegment(id: segments.count, lines: current, comments: matching))
            current = []
        }
    }
    if !current.isEmpty {
        segments.append(DiffSegment(id: segments.count, lines: current, comments: []))
    }
    return segments
}
