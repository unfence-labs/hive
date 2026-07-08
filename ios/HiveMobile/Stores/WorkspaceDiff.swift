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
