import Foundation

// MARK: - Tool Display Helpers
//
// Pure tool-call presentation helpers shared by the step detail views and the
// timeline step view-model (`Models/TimelineSteps.swift`). Mirrors the parts of
// `frontend/src/lib/tool-display.tsx` the step grammar still reads.

struct ChatActivityStats: Equatable {
    enum Kind { case diff, plain }
    let kind: Kind
    var added: Int = 0
    var removed: Int = 0
    var label: String?
}

func getFilename(_ path: String) -> String {
    (path as NSString).lastPathComponent
}

/// Resolve file path across providers (Claude: file_path, Codex: filename).
func resolveFilePath(_ input: [String: Any]) -> String? {
    (input["file_path"] ?? input["filename"]) as? String
}

/// Compute edit diff stats using prefix/suffix line matching.
func computeEditDiffStats(oldString: String, newString: String) -> (added: Int, removed: Int) {
    let oldLines = oldString.split(separator: "\n", omittingEmptySubsequences: false)
    let newLines = newString.split(separator: "\n", omittingEmptySubsequences: false)
    // Common prefix
    var prefix = 0
    while prefix < oldLines.count && prefix < newLines.count && oldLines[prefix] == newLines[prefix] {
        prefix += 1
    }
    // Common suffix (not overlapping with prefix)
    var suffix = 0
    while suffix < oldLines.count - prefix && suffix < newLines.count - prefix
            && oldLines[oldLines.count - 1 - suffix] == newLines[newLines.count - 1 - suffix] {
        suffix += 1
    }
    let removed = oldLines.count - prefix - suffix
    let added = newLines.count - prefix - suffix
    return (added, removed)
}

func computeToolStats(_ tool: ToolCall) -> ChatActivityStats? {
    guard let input = parsedToolInputObject(tool.input) else {
        return nil
    }

    switch tool.name {
    case "Edit":
        let oldString = input["old_string"] as? String
        let newString = input["new_string"] as? String
        let diff = input["diff"] as? String
        if let diff, !diff.isEmpty {
            let stats = parseDiffStats(diff)
            guard stats.added > 0 || stats.removed > 0 else { return nil }
            return ChatActivityStats(kind: .diff, added: stats.added, removed: stats.removed)
        }
        guard (oldString != nil && !oldString!.isEmpty) || (newString != nil && !newString!.isEmpty) else { return nil }
        let stats = computeEditDiffStats(oldString: oldString ?? "", newString: newString ?? "")
        guard stats.added > 0 || stats.removed > 0 else { return nil }
        return ChatActivityStats(kind: .diff, added: stats.added, removed: stats.removed)

    case "Write":
        guard let content = input["content"] as? String, !content.isEmpty else { return nil }
        let lineCount = content.components(separatedBy: "\n").count
        return ChatActivityStats(kind: .diff, added: lineCount, removed: 0)

    case "Grep":
        guard let output = tool.output, !output.isEmpty else { return nil }
        let lines = output.split(separator: "\n", omittingEmptySubsequences: true)
        guard !lines.isEmpty else { return nil }
        return ChatActivityStats(kind: .plain, label: "\(lines.count) result\(lines.count != 1 ? "s" : "")")

    case "Glob":
        guard let output = tool.output, !output.isEmpty else { return nil }
        let lines = output.split(separator: "\n", omittingEmptySubsequences: true)
        guard !lines.isEmpty else { return nil }
        return ChatActivityStats(kind: .plain, label: "\(lines.count) file\(lines.count != 1 ? "s" : "")")

    default:
        return nil
    }
}

/// Tools whose output duplicates what the detail already shows (the diff, the questions).
func toolHidesOutput(_ name: String) -> Bool {
    name == "Edit" || name == "AskUserQuestion"
}

func getOutputSummary(_ tool: ToolCall) -> String? {
    guard let output = tool.output, !output.isEmpty else { return nil }
    let lines = output.split(separator: "\n", omittingEmptySubsequences: true)
    if lines.count == 1, lines[0].count < 60 { return String(lines[0]) }
    if lines.count > 1 { return "\(lines.count) lines" }
    return nil
}

/// Text of a JSON content-block array (`[{"type":"text","text":...}]`), joined by
/// blank lines, or nil when the output is anything else. Mirrors `parseContentBlocks`.
func parseContentBlocks(_ output: String) -> String? {
    guard let data = output.data(using: .utf8),
          let parsed = try? JSONSerialization.jsonObject(with: data),
          let blocks = parsed as? [Any] else { return nil }
    let texts = blocks.compactMap { block -> String? in
        guard let block = block as? [String: Any], block["type"] as? String == "text" else { return nil }
        return block["text"] as? String
    }
    return texts.isEmpty ? nil : texts.joined(separator: "\n\n")
}
