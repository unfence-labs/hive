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
    var oldLine: Int? = nil
    var newLine: Int? = nil

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
    var inHunk = false
    for line in diff.split(separator: "\n", omittingEmptySubsequences: false) {
        if line.hasPrefix("diff --git ") { inHunk = false; continue }
        if line.hasPrefix("@@") { inHunk = true; continue }
        if !inHunk, line.hasPrefix("+++") || line.hasPrefix("---") { continue }
        if line.hasPrefix("+") {
            added += 1
        } else if line.hasPrefix("-") {
            removed += 1
        }
    }
    return (added, removed)
}

private func parseHunkHeader(_ line: String) -> (old: Int, new: Int)? {
    let parts = line.split(separator: " ")
    guard parts.count >= 3,
          parts[1].hasPrefix("-"), parts[2].hasPrefix("+"),
          let old = Int(parts[1].dropFirst().split(separator: ",")[0]),
          let new = Int(parts[2].dropFirst().split(separator: ",")[0])
    else { return nil }
    return (old, new)
}

func parseUnifiedDiffLines(_ diff: String, includeHunkMarkers: Bool = false) -> [DiffLine] {
    var result: [DiffLine] = []
    var index = 0
    var inHunk = false
    var oldNext = 0
    var newNext = 0
    var numbering = false
    for raw in diff.split(separator: "\n", omittingEmptySubsequences: false) {
        let line = String(raw)
        if line.hasPrefix("diff --git ") { inHunk = false; continue }
        if line.hasPrefix("@@") {
            inHunk = true
            if let header = parseHunkHeader(line) {
                oldNext = header.old
                newNext = header.new
                numbering = true
            }
            if includeHunkMarkers, !result.isEmpty {
                result.append(DiffLine(id: index, kind: .hunk, text: ""))
                index += 1
            }
            continue
        }
        if !inHunk, line.hasPrefix("+++") || line.hasPrefix("---") { continue }
        if line.hasPrefix("+") {
            result.append(DiffLine(id: index, kind: .added, text: String(line.dropFirst()), newLine: numbering ? newNext : nil))
            newNext += 1
            index += 1
        } else if line.hasPrefix("-") {
            result.append(DiffLine(id: index, kind: .removed, text: String(line.dropFirst()), oldLine: numbering ? oldNext : nil))
            oldNext += 1
            index += 1
        } else {
            let text = line.hasPrefix(" ") ? String(line.dropFirst()) : line
            result.append(DiffLine(id: index, kind: .context, text: text, oldLine: numbering ? oldNext : nil, newLine: numbering ? newNext : nil))
            oldNext += 1
            newNext += 1
            index += 1
        }
    }
    return result
}

struct DiffComment: Identifiable, Equatable {
    let id = UUID()
    let file: String
    let lineID: Int
    let line: String
    var lineNumber: Int? = nil
    var side: String = "new code"
    var snippet: String?
    var text: String
}

extension DiffComment {
    init(file: String, line: DiffLine, snippet: String?) {
        self.init(
            file: file,
            lineID: line.id,
            line: line.text,
            lineNumber: line.kind == .removed ? line.oldLine : (line.newLine ?? line.oldLine),
            side: line.kind == .removed ? "old code" : "new code",
            snippet: snippet,
            text: ""
        )
    }
}

func compileReview(_ comments: [DiffComment]) -> String {
    var sections: [String] = ["Review comments on the current diff:"]
    for comment in comments {
        let location = comment.lineNumber.map { " (line \($0), \(comment.side))" } ?? ""
        let quoted = (comment.snippet ?? comment.line).trimmingCharacters(in: .whitespacesAndNewlines)
        sections.append("In `\(comment.file)`\(location):\n> \(quoted.replacingOccurrences(of: "\n", with: "\n> "))\n\(comment.text)")
    }
    return sections.joined(separator: "\n\n")
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
        let matching = remaining.filter { $0.lineID == line.id }
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
